#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { analyzePackage, sortPackages, summarizePackages, type DependencyInput } from "./analyzer.js";
import { formatJson, formatTable } from "./formatter.js";
import { fetchRegistryMetadata } from "./registry.js";

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
  .option("--sort <field>", "Sort by: age|name|status", "status");

program.parse(process.argv);

const options = program.opts<{
  cwd: string;
  json: boolean;
  deprecatedOnly: boolean;
  dev: boolean;
  sort: string;
}>();

const validSorts = new Set(["age", "name", "status"]);

if (!validSorts.has(options.sort)) {
  console.error(`Invalid sort field: ${options.sort}`);
  process.exit(1);
}

try {
  const projectDir = path.resolve(options.cwd);
  const dependencies = await readDependencies(projectDir, options.dev);

  if (dependencies.length === 0) {
    console.log(options.json ? JSON.stringify({ generatedAt: new Date().toISOString(), packages: [], summary: {} }, null, 2) : "No dependencies found.");
    process.exit(0);
  }

  if (!options.json) {
    console.log(`Checking ${dependencies.length} dependencies...\n`);
  }

  const registryResults = await fetchRegistryMetadata(dependencies.map((entry) => entry.name));
  const analyzed = dependencies.flatMap((dependency) => {
    const result = registryResults.get(dependency.name);
    if (!result?.data) {
      return [];
    }
    return [analyzePackage(dependency, result.data)];
  });

  const filtered = options.deprecatedOnly ? analyzed.filter((item) => item.status === "deprecated") : analyzed;
  const sorted = sortPackages(filtered, options.sort as "age" | "name" | "status");
  const summary = summarizePackages(sorted);

  console.log(options.json ? formatJson(sorted, summary) : formatTable(sorted, summary));

  const failures = dependencies
    .map((dependency) => ({ name: dependency.name, result: registryResults.get(dependency.name) }))
    .filter((item) => item.result?.error);

  if (failures.length > 0 && !options.json) {
    console.error("");
    for (const failure of failures) {
      console.error(`Failed to inspect ${failure.name}: ${failure.result?.error}`);
    }
  }
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
