#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { analyzePackage, analyzePackageUpdate, normalizeVersionSpecifier, sortPackages, summarizePackages, type DependencyInput } from "./analyzer.js";
import { lookupAlternative } from "./alternatives.js";
import { formatJson, formatTable, formatUpdateTable } from "./formatter.js";
import { fetchRegistryMetadata, fetchSecurityAdvisories, type RegistryFetchResult } from "./registry.js";
import { scorePackageRisk, summarizeVulnerabilities } from "./risk-scorer.js";
import { runWatcher } from "./watcher.js";

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const program = new Command();

program
  .name("pkg-age")
  .description("Show the health age of your npm dependencies.")
  .option("--cwd <path>", "Project directory", process.cwd())
  .option("--json", "Emit JSON output", false)
  .option("--deprecated-only", "Only show deprecated packages", false)
  .option("--no-dev", "Skip devDependencies")
  .option("--sort <field>", "Sort by: age|name|status", "status")
  .option("--watch", "Re-check packages periodically and report status changes", false)
  .option("--interval <seconds>", "Watch interval in seconds", "86400")
  .option("--update-check", "Show available upgrades and grouped install commands", false)
  .option("--risk-score", "Score dependencies by age, maintenance, and security risk", false)
  .option("--alternatives", "Suggest replacements for risky or outdated packages", false);

program.parse(process.argv);

const options = program.opts<{
  cwd: string;
  json: boolean;
  deprecatedOnly: boolean;
  dev: boolean;
  sort: string;
  watch: boolean;
  interval: string;
  updateCheck: boolean;
  riskScore: boolean;
  alternatives: boolean;
}>();

const validSorts = new Set(["age", "name", "status"]);

if (!validSorts.has(options.sort)) {
  console.error(`Invalid sort field: ${options.sort}`);
  process.exit(1);
}

const intervalSeconds = Number.parseInt(options.interval, 10);
if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
  console.error(`Invalid interval value: ${options.interval}`);
  process.exit(1);
}

try {
  const projectDir = path.resolve(options.cwd);
  const dependencies = await readDependencies(projectDir, options.dev);

  if (dependencies.length === 0) {
    console.log(options.json ? JSON.stringify({ generatedAt: new Date().toISOString(), packages: [], summary: {} }, null, 2) : "No dependencies found.");
    process.exit(0);
  }

  if (options.watch) {
    await runWatcher({
      projectDir,
      packageCount: dependencies.length,
      intervalSeconds,
      inspect: async () => inspectPackages(dependencies),
    });
  }

  if (options.updateCheck) {
    const { updates, failures } = await inspectPackageUpdates(dependencies);
    console.log(formatUpdateTable(updates));
    printUpgradeCommands(updates);
    printFailures(failures, options.json);
    process.exit(0);
  }

  if (options.riskScore) {
    const riskResults = await inspectPackageRisks(dependencies);
    console.log(formatRiskAnalysis(riskResults.risks));
    printFailures(riskResults.failures, options.json);
    process.exit(0);
  }

  if (options.alternatives) {
    const alternatives = await inspectAlternatives(dependencies);
    console.log(formatAlternatives(alternatives.suggestions));
    printFailures(alternatives.failures, options.json);
    process.exit(0);
  }

  if (!options.json) {
    console.log(`Checking ${dependencies.length} dependencies...\n`);
  }

  const { analyzed, failures } = await inspectPackagesWithFailures(dependencies);
  const filtered = options.deprecatedOnly ? analyzed.filter((item) => item.status === "deprecated") : analyzed;
  const sorted = sortPackages(filtered, options.sort as "age" | "name" | "status");
  const summary = summarizePackages(sorted);

  console.log(options.json ? formatJson(sorted, summary) : formatTable(sorted, summary));
  printFailures(failures, options.json);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exit(1);
}

async function readDependencies(projectDir: string, includeDev: boolean): Promise<DependencyInput[]> {
  const packageJsonPath = path.join(projectDir, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(raw) as PackageJsonShape;
  const dependencies: DependencyInput[] = [];

  for (const [name, specifier] of Object.entries(packageJson.dependencies ?? {})) {
    dependencies.push({ name, specifier, section: "dependencies" });
  }

  if (includeDev) {
    for (const [name, specifier] of Object.entries(packageJson.devDependencies ?? {})) {
      dependencies.push({ name, specifier, section: "devDependencies" });
    }
  }

  return dependencies;
}

async function inspectPackages(dependencies: DependencyInput[]) {
  const { analyzed } = await inspectPackagesWithFailures(dependencies);
  return analyzed;
}

async function inspectPackagesWithFailures(dependencies: DependencyInput[]) {
  const registryResults = await fetchRegistryMetadata(dependencies.map((entry) => entry.name));
  const analyzed = dependencies.flatMap((dependency) => {
    const result = registryResults.get(dependency.name);
    if (!result?.data) {
      return [];
    }
    return [analyzePackage(dependency, result.data)];
  });

  const failures = dependencies
    .map((dependency) => ({ name: dependency.name, result: registryResults.get(dependency.name) }))
    .filter((item) => item.result?.error);

  return { analyzed, failures };
}

async function inspectPackageUpdates(dependencies: DependencyInput[]) {
  const registryResults = await fetchRegistryMetadata(dependencies.map((entry) => entry.name));
  const updates = dependencies.flatMap((dependency) => {
    const result = registryResults.get(dependency.name);
    if (!result?.data) {
      return [];
    }
    return [analyzePackageUpdate(dependency, result.data)];
  });

  const failures = dependencies
    .map((dependency) => ({ name: dependency.name, result: registryResults.get(dependency.name) }))
    .filter((item) => item.result?.error);

  return { updates, failures };
}

async function inspectPackageRisks(dependencies: DependencyInput[]) {
  const { analyzed, failures } = await inspectPackagesWithFailures(dependencies);
  const advisoryResults = await fetchSecurityAdvisories(
    dependencies.map((dependency) => ({
      name: dependency.name,
      version: normalizeVersionSpecifier(dependency.specifier),
    })),
  );

  const risks = analyzed
    .map((item) => {
      const advisories = advisoryResults.get(item.name);
      const vulnerabilitySummary = summarizeVulnerabilities(advisories?.advisories ?? []);
      return scorePackageRisk(item, vulnerabilitySummary);
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  return {
    risks,
    failures: [
      ...failures,
      ...dependencies
        .map((dependency) => ({ name: dependency.name, advisories: advisoryResults.get(dependency.name) }))
        .filter((item) => item.advisories?.error)
        .map((item) => ({
          name: item.name,
          result: {
            data: null,
            error: item.advisories?.error ?? "unknown advisory error",
          },
        })),
    ],
  };
}

async function inspectAlternatives(dependencies: DependencyInput[]) {
  const { analyzed, failures } = await inspectPackagesWithFailures(dependencies);
  const updates = await inspectPackageUpdates(dependencies);
  const advisoryResults = await fetchSecurityAdvisories(
    dependencies.map((dependency) => ({
      name: dependency.name,
      version: normalizeVersionSpecifier(dependency.specifier),
    })),
  );
  const updateByName = new Map(updates.updates.map((item) => [item.name, item]));

  const suggestions = analyzed
    .flatMap((item) => {
      const alternative = lookupAlternative(item.name);
      if (!alternative) {
        return [];
      }

      const vulnerabilitySummary = summarizeVulnerabilities(advisoryResults.get(item.name)?.advisories ?? []);
      const update = updateByName.get(item.name);
      const shouldSuggest =
        item.status !== "active" ||
        item.hasMajorUpdate ||
        vulnerabilitySummary.total > 0 ||
        update?.commandGroup === "risky";

      if (!shouldSuggest) {
        return [];
      }

      return [{
        name: item.name,
        version: item.currentVersion,
        alternative,
      }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    suggestions,
    failures: [
      ...failures,
      ...updates.failures,
      ...dependencies
        .map((dependency) => ({ name: dependency.name, advisories: advisoryResults.get(dependency.name) }))
        .filter((item) => item.advisories?.error)
        .map((item) => ({
          name: item.name,
          result: {
            data: null,
            error: item.advisories?.error ?? "unknown advisory error",
          },
        })),
    ],
  };
}

function printUpgradeCommands(
  updates: Array<ReturnType<typeof analyzePackageUpdate>>,
): void {
  const safe = updates.filter((item) => item.commandGroup === "safe").map((item) => `${item.name}@latest`);
  const risky = updates.filter((item) => item.commandGroup === "risky").map((item) => `${item.name}@latest`);

  console.log("");
  console.log("Safe upgrades (patch/minor only):");
  console.log(safe.length > 0 ? `  npm install ${safe.join(" ")}` : "  None");
  console.log("");
  console.log("Major upgrades (review changelogs first):");
  console.log(risky.length > 0 ? `  npm install ${risky.join(" ")}` : "  None");
}

function printFailures(
  failures: Array<{ name: string; result: RegistryFetchResult | undefined }>,
  json: boolean,
): void {
  if (failures.length === 0 || json) {
    return;
  }

  console.error("");
  for (const failure of failures) {
    console.error(`Failed to inspect ${failure.name}: ${failure.result?.error}`);
  }
}

function formatRiskAnalysis(results: Awaited<ReturnType<typeof inspectPackageRisks>>["risks"]): string {
  if (results.length === 0) {
    return "No dependencies found.";
  }

  const lines = ["Dependency Risk Analysis:", ""];

  for (const item of results) {
    lines.push(`  ${item.name}@${item.version}  Risk: ${item.score}/100 (${item.level})`);
    for (const factor of item.factors) {
      lines.push(`    ${factor.label.padEnd(36)} (+${factor.points})`);
    }
    lines.push("");
  }

  const topRisks = results.filter((item) => item.score >= 25).slice(0, 3).map((item) => item.name);
  lines.push(topRisks.length > 0 ? `Top risks: ${topRisks.join(", ")}` : "Top risks: none");
  return lines.join("\n");
}

function formatAlternatives(results: Awaited<ReturnType<typeof inspectAlternatives>>["suggestions"]): string {
  if (results.length === 0) {
    return "No risky packages with known alternatives found.";
  }

  return [
    "Outdated packages with better alternatives:",
    "",
    ...results.map((item) => {
      const suggestionText =
        item.alternative.suggestions.length === 1
          ? item.alternative.suggestions[0]
          : `${item.alternative.suggestions.slice(0, -1).join(" or ")} or ${item.alternative.suggestions.at(-1)}`;
      return `  ${item.name}@${item.version} -> ${suggestionText} (${item.alternative.reason})`;
    }),
  ].join("\n");
}
