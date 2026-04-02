import assert from "node:assert/strict";
import test from "node:test";

import type { AnalyzedPackage } from "../src/analyzer.js";
import { detectWatchStatusChanges, formatWatchStatusChange } from "../src/watcher.js";

function analyzedPackage(overrides: Partial<AnalyzedPackage> = {}): AnalyzedPackage {
  return {
    name: "example",
    section: "dependencies",
    specifier: "^1.0.0",
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    latestReleaseDate: "2024-01-01T00:00:00.000Z",
    ageDays: 10,
    ageLabel: "10 days ago",
    majorVersionsBehind: 0,
    hasMajorUpdate: false,
    status: "active",
    severity: 4,
    deprecatedMessage: null,
    archived: false,
    statusLabel: "active",
    ...overrides,
  };
}

test("detectWatchStatusChanges only emits actual status transitions", () => {
  const results = [
    analyzedPackage({ name: "left-pad", status: "unmaintained", ageDays: 732, statusLabel: "unmaintained (no release in 2+ years)" }),
    analyzedPackage({ name: "chalk", status: "active" }),
  ];

  const { changes, nextState } = detectWatchStatusChanges(results, {
    "left-pad": "old",
    chalk: "active",
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.name, "left-pad");
  assert.equal(changes[0]?.previousStatus, "old");
  assert.equal(changes[0]?.nextStatus, "unmaintained");
  assert.deepEqual(nextState, {
    "left-pad": "unmaintained",
    chalk: "active",
  });
});

test("formatWatchStatusChange includes timestamp and age detail for unmaintained packages", () => {
  const line = formatWatchStatusChange(
    {
      name: "left-pad",
      previousStatus: "old",
      nextStatus: "unmaintained",
      packageResult: analyzedPackage({
        name: "left-pad",
        status: "unmaintained",
        ageDays: 732,
        statusLabel: "unmaintained (no release in 2+ years)",
      }),
    },
    new Date("2026-04-02T09:00:00.000Z"),
  );

  assert.equal(
    line,
    "[2026-04-02 09:00] left-pad: old -> unmaintained (last release 732 days ago) 🔔",
  );
});
