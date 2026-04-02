#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { analyzePackage, analyzePackageUpdate, sortPackages, summarizePackages, type DependencyInput } from "./analyzer.js";
import { formatJson, formatTable, formatUpdateTable } from "./formatter.js";
import { fetchRegistryMetadata, type RegistryFetchResult } from "./registry.js";
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
  .option("--update-check", "Show available upgrades and grouped install commands", false);

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
