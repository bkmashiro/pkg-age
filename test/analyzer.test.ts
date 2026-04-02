import test from "node:test";
import assert from "node:assert/strict";

import { analyzePackage, formatAge } from "../src/analyzer.js";

const NOW = new Date("2026-04-02T00:00:00.000Z");

function registry(overrides: Partial<Parameters<typeof analyzePackage>[1]> = {}) {
  return {
    name: "example",
    latestVersion: "5.0.0",
    latestReleaseDate: "2026-03-03T00:00:00.000Z",
    deprecatedMessage: null,
    archived: false,
    versions: ["4.0.0", "5.0.0"],
    ...overrides,
  };
}

function dependency(specifier = "^4.1.0") {
  return {
    name: "example",
    specifier,
    section: "dependencies" as const,
  };
}

test("package with deprecated field is marked deprecated", () => {
  const result = analyzePackage(
    dependency(),
    registry({
      latestVersion: "4.1.0",
      deprecatedMessage: "Use date-fns",
    }),
    NOW,
  );

  assert.equal(result.status, "deprecated");
  assert.match(result.statusLabel, /DEPRECATED/);
});

test("last release 800 days ago is unmaintained when no major update exists", () => {
  const result = analyzePackage(
    dependency("^4.1.0"),
    registry({
      latestVersion: "4.1.0",
      latestReleaseDate: "2024-01-23T00:00:00.000Z",
      versions: ["4.1.0"],
    }),
    NOW,
  );

  assert.equal(result.status, "unmaintained");
});

test("last release 200 days ago is old", () => {
  const result = analyzePackage(
    dependency("^5.0.0"),
    registry({
      latestVersion: "5.0.0",
      latestReleaseDate: "2025-09-14T00:00:00.000Z",
      versions: ["5.0.0"],
    }),
    NOW,
  );

  assert.equal(result.status, "old");
});

test("last release 30 days ago is active", () => {
  const result = analyzePackage(
    dependency("^5.0.0"),
    registry({
      latestVersion: "5.0.0",
      latestReleaseDate: "2026-03-03T00:00:00.000Z",
      versions: ["5.0.0"],
    }),
    NOW,
  );

  assert.equal(result.status, "active");
});

test("older major installed version reports major update available", () => {
  const result = analyzePackage(dependency("^4.2.0"), registry(), NOW);

  assert.equal(result.hasMajorUpdate, true);
  assert.equal(result.majorVersionsBehind, 1);
});

test("same major does not report a major update warning", () => {
  const result = analyzePackage(
    dependency("^5.1.0"),
    registry({
      latestVersion: "5.4.0",
    }),
    NOW,
  );

  assert.equal(result.hasMajorUpdate, false);
});

test("age formatting renders years, months, and days", () => {
  assert.equal(formatAge(365), "1 year ago");
  assert.equal(formatAge(30), "1 month ago");
  assert.equal(formatAge(5), "5 days ago");
});
