import type { AnalyzedPackage } from "./analyzer.js";

export type VulnerabilitySeverity = "critical" | "high" | "moderate" | "low" | "info";

export interface VulnerabilityAdvisory {
  id: number;
  url: string;
  title: string;
  severity: VulnerabilitySeverity;
}

export interface VulnerabilitySummary {
  advisories: VulnerabilityAdvisory[];
  bySeverity: Record<VulnerabilitySeverity, number>;
  total: number;
}

export interface RiskFactor {
  label: string;
  points: number;
}

export interface PackageRiskScore {
  name: string;
  version: string;
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH";
  factors: RiskFactor[];
  vulnerabilities: VulnerabilitySummary;
}

const AGE_POINTS = [
  { minDays: 730, points: 20, label: (days: number) => `Age: ${days} days since last release` },
  { minDays: 365, points: 15, label: (days: number) => `Age: ${days} days since last release` },
  { minDays: 180, points: 10, label: (days: number) => `Age: ${days} days since last release` },
  { minDays: 90, points: 5, label: (days: number) => `Age: ${days} days since last release` },
];

const EMPTY_VULN_COUNTS: Record<VulnerabilitySeverity, number> = {
  critical: 0,
  high: 0,
  moderate: 0,
  low: 0,
  info: 0,
};

export function summarizeVulnerabilities(advisories: VulnerabilityAdvisory[]): VulnerabilitySummary {
  const bySeverity = { ...EMPTY_VULN_COUNTS };

  for (const advisory of advisories) {
    bySeverity[advisory.severity] += 1;
  }

  return {
    advisories,
    bySeverity,
    total: advisories.length,
  };
}

export function scorePackageRisk(
  analyzed: AnalyzedPackage,
  vulnerabilitySummary: VulnerabilitySummary,
): PackageRiskScore {
  const factors: RiskFactor[] = [];

  if (analyzed.ageDays !== null) {
    const ageDays = analyzed.ageDays;
    const ageBand = AGE_POINTS.find((item) => ageDays >= item.minDays);
    if (ageBand) {
      factors.push({
        label: ageBand.label(ageDays),
        points: ageBand.points,
      });
    }
  }

  if (analyzed.status === "deprecated") {
    factors.push({ label: "Deprecated package", points: 25 });
  } else if (analyzed.status === "archived") {
    factors.push({ label: "Archived package", points: 20 });
  } else if (analyzed.status === "unmaintained") {
    factors.push({ label: "Unmaintained: no release in 2+ years", points: 12 });
  } else if (analyzed.status === "old") {
    factors.push({ label: "Maintenance slowing down", points: 6 });
  }

  if (analyzed.hasMajorUpdate) {
    factors.push({
      label:
        analyzed.majorVersionsBehind === 1
          ? "1 major version behind latest"
          : `${analyzed.majorVersionsBehind} major versions behind latest`,
      points: Math.min(10, analyzed.majorVersionsBehind * 4),
    });
  }

  const vulnerabilityFactors = vulnerabilityFactorsFromSummary(vulnerabilitySummary);
  factors.push(...vulnerabilityFactors);

  const score = Math.min(
    100,
    factors.reduce((total, factor) => total + factor.points, 0),
  );

  return {
    name: analyzed.name,
    version: analyzed.currentVersion,
    score,
    level: riskLevel(score),
    factors,
    vulnerabilities: vulnerabilitySummary,
  };
}

function vulnerabilityFactorsFromSummary(summary: VulnerabilitySummary): RiskFactor[] {
  const factors: RiskFactor[] = [];

  if (summary.bySeverity.critical > 0) {
    factors.push({
      label: formatSeverityLabel(summary.bySeverity.critical, "critical", "CVE"),
      points: Math.min(30, summary.bySeverity.critical * 30),
    });
  }
  if (summary.bySeverity.high > 0) {
    factors.push({
      label: formatSeverityLabel(summary.bySeverity.high, "high", "advisory"),
      points: Math.min(25, summary.bySeverity.high * 20),
    });
  }
  if (summary.bySeverity.moderate > 0) {
    factors.push({
      label: formatSeverityLabel(summary.bySeverity.moderate, "moderate", "advisory"),
      points: Math.min(15, summary.bySeverity.moderate * 10),
    });
  }
  if (summary.bySeverity.low > 0) {
    factors.push({
      label: formatSeverityLabel(summary.bySeverity.low, "low", "advisory"),
      points: Math.min(5, summary.bySeverity.low * 5),
    });
  }

  if (factors.length === 0) {
    factors.push({ label: "No known advisories", points: 0 });
  }

  return factors;
}

function riskLevel(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score >= 60) {
    return "HIGH";
  }
  if (score >= 25) {
    return "MEDIUM";
  }
  return "LOW";
}

function formatSeverityLabel(count: number, severity: string, suffix: string): string {
  const noun = count === 1 ? suffix : `${suffix}s`;
  return `Vulnerabilities: ${count} ${severity} ${noun}`;
}
