import assert from "node:assert/strict";
import test from "node:test";

import type { AnalyzedPackage } from "../src/analyzer.js";
import { lookupAlternative } from "../src/alternatives.js";
import { scorePackageRisk, summarizeVulnerabilities, type VulnerabilityAdvisory } from "../src/risk-scorer.js";

function analyzedPackage(overrides: Partial<AnalyzedPackage> = {}): AnalyzedPackage {
  return {
    name: "lodash",
    section: "dependencies",
    specifier: "^4.17.20",
    currentVersion: "4.17.20",
    latestVersion: "4.17.21",
    latestReleaseDate: "2024-01-01T00:00:00.000Z",
    ageDays: 847,
    ageLabel: "2 years ago",
    majorVersionsBehind: 0,
    hasMajorUpdate: false,
    status: "unmaintained",
    severity: 2,
    deprecatedMessage: null,
    archived: false,
    statusLabel: "unmaintained (no release in 2+ years)",
    ...overrides,
  };
}

function advisories(input: VulnerabilityAdvisory[]): VulnerabilityAdvisory[] {
  return input;
}

test("risk score combines age, maintenance, and vulnerability factors", () => {
  const result = scorePackageRisk(
    analyzedPackage(),
    summarizeVulnerabilities(
      advisories([
        {
          id: 1,
          url: "https://example.com/1",
          title: "Critical issue",
          severity: "critical",
        },
      ]),
    ),
  );

  assert.equal(result.score, 62);
  assert.equal(result.level, "HIGH");
  assert.deepEqual(
    result.factors.map((factor) => factor.label),
    [
      "Age: 847 days since last release",
      "Unmaintained: no release in 2+ years",
      "Vulnerabilities: 1 critical CVE",
    ],
  );
});

test("risk score stays low for recent actively maintained packages without advisories", () => {
  const result = scorePackageRisk(
    analyzedPackage({
      name: "chalk",
      currentVersion: "5.3.0",
      latestVersion: "5.3.0",
      ageDays: 30,
      status: "active",
      statusLabel: "active",
    }),
    summarizeVulnerabilities([]),
  );

  assert.equal(result.score, 0);
  assert.equal(result.level, "LOW");
  assert.deepEqual(result.factors, [{ label: "No known advisories", points: 0 }]);
});

test("lookupAlternative returns curated replacements for known packages", () => {
  assert.deepEqual(lookupAlternative("moment"), {
    name: "moment",
    suggestions: ["dayjs", "date-fns"],
    reason: "moment is in maintenance mode and newer date libraries are smaller",
  });
  assert.equal(lookupAlternative("left-pad"), null);
});
