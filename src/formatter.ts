import chalk from "chalk";

import type { AnalysisSummary, AnalyzedPackage } from "./analyzer.js";

interface JsonOutput {
  generatedAt: string;
  packages: AnalyzedPackage[];
  summary: AnalysisSummary;
}

export function formatTable(results: AnalyzedPackage[], summary: AnalysisSummary): string {
  if (results.length === 0) {
    return "No matching dependencies found.";
  }

  const headers = ["Package", "Current", "Latest", "Age", "Status"];
  const rows = results.map((item) => [
    item.name,
    item.currentVersion,
    item.latestVersion,
    item.ageLabel,
    renderStatus(item),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(row[index]).length)),
  );

  const lines = [
    formatRow(headers, widths, { header: true }),
    ...rows.map((row) => formatRow(row, widths)),
    "",
    formatSummary(summary),
  ];

  return lines.join("\n");
}

export function formatJson(results: AnalyzedPackage[], summary: AnalysisSummary): string {
  const payload: JsonOutput = {
    generatedAt: new Date().toISOString(),
    packages: results,
    summary,
  };
  return JSON.stringify(payload, null, 2);
}

function renderStatus(item: AnalyzedPackage): string {
  if (item.status === "deprecated") {
    return chalk.red(`✗ ${item.statusLabel}`);
  }
  if (item.status === "archived") {
    return chalk.red(`✗ ${item.statusLabel}`);
  }
  if (item.status === "unmaintained" || item.status === "old" || item.status === "outdated") {
    return chalk.yellow(`⚠ ${item.statusLabel}`);
  }
  return chalk.green(`✓ ${item.statusLabel}`);
}

function formatSummary(summary: AnalysisSummary): string {
  const parts: string[] = [];
  if (summary.deprecated > 0) {
    parts.push(`${summary.deprecated} deprecated`);
  }
  if (summary.archived > 0) {
    parts.push(`${summary.archived} archived`);
  }
  if (summary.unmaintained > 0) {
    parts.push(`${summary.unmaintained} unmaintained`);
  }
  if (summary.old > 0) {
    parts.push(`${summary.old} old`);
  }
  if (summary.majorUpdates > 0) {
    parts.push(`${summary.majorUpdates} major updates available`);
  }

  return parts.length > 0 ? `Summary: ${parts.join(", ")}` : "Summary: all dependencies look active";
}

function formatRow(columns: string[], widths: number[], options?: { header?: boolean }): string {
  const cells = columns.map((column, index) => column.padEnd(widths[index]));
  const line = cells.join("  ");
  return options?.header ? chalk.bold(line) : line;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}
