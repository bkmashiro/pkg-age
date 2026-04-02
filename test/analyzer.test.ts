import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzePackage,
  analyzePackageUpdate,
  formatAge,
  normalizeVersionSpecifier,
  parseMajorVersion,
  sortPackages,
  summarizePackages,
} from "../src/analyzer.js";

const NOW = new Date("2026-04-02T00:00:00.000Z");

function registry(overrides: Partial<Parameters<typeof analyzePackage>[1]> = {}) {
  return {
    name: "example",
    latestVersion: "5.0.0",
    latestReleaseDate: "2026-03-03T00:00:00.000Z",
    deprecatedMessage: null,
    archived: false,
    esmOnlyLatest: false,
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
  assert.equal(result.status, "outdated");
  assert.equal(result.statusLabel, "1 major behind");
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

test("archived packages are marked archived before age-based checks", () => {
  const result = analyzePackage(
    dependency("^5.0.0"),
    registry({
      latestVersion: "5.0.0",
      latestReleaseDate: "2023-01-01T00:00:00.000Z",
      archived: true,
    }),
    NOW,
  );

  assert.equal(result.status, "archived");
  assert.equal(result.statusLabel, "archived");
});

test("old packages with a major update keep the old status and label the update", () => {
  const result = analyzePackage(
    dependency("^4.0.0"),
    registry({
      latestVersion: "6.0.0",
      latestReleaseDate: "2025-08-01T00:00:00.000Z",
      versions: ["4.0.0", "6.0.0"],
    }),
    NOW,
  );

  assert.equal(result.status, "old");
  assert.equal(result.statusLabel, "old (major update available!)");
  assert.equal(result.majorVersionsBehind, 2);
});

test("missing release date reports unknown age", () => {
  const result = analyzePackage(
    dependency("^5.0.0"),
    registry({
      latestVersion: "5.0.0",
      latestReleaseDate: null,
      versions: ["5.0.0"],
    }),
    NOW,
  );

  assert.equal(result.ageDays, null);
  assert.equal(result.ageLabel, "unknown");
});

test("age formatting renders years, months, and days", () => {
  assert.equal(formatAge(null), "unknown");
  assert.equal(formatAge(365), "1 year ago");
  assert.equal(formatAge(730), "2 years ago");
  assert.equal(formatAge(30), "1 month ago");
  assert.equal(formatAge(60), "2 months ago");
  assert.equal(formatAge(0), "today");
  assert.equal(formatAge(-1), "today");
  assert.equal(formatAge(1), "1 day ago");
  assert.equal(formatAge(5), "5 days ago");
});

test("version helpers normalize specifiers and parse majors", () => {
  assert.equal(normalizeVersionSpecifier("^1.2.3"), "1.2.3");
  assert.equal(normalizeVersionSpecifier("workspace:^2.3.4-beta.1"), "2.3.4-beta.1");
  assert.equal(normalizeVersionSpecifier("npm:chalk@5"), "5");
  assert.equal(parseMajorVersion("12.4.0"), 12);
  assert.equal(parseMajorVersion("next"), null);
});

test("sortPackages sorts by name, age, and severity without mutating input", () => {
  const archived = analyzePackage(
    { name: "zeta", specifier: "^5.0.0", section: "dependencies" },
    registry({ name: "zeta", latestVersion: "5.0.0", archived: true, versions: ["5.0.0"] }),
    NOW,
  );
  const old = analyzePackage(
    { name: "alpha", specifier: "^5.0.0", section: "dependencies" },
    registry({
      name: "alpha",
      latestVersion: "5.0.0",
      latestReleaseDate: "2025-01-01T00:00:00.000Z",
      versions: ["5.0.0"],
    }),
    NOW,
  );
  const active = analyzePackage(
    { name: "beta", specifier: "^5.0.0", section: "dependencies" },
    registry({ name: "beta", latestVersion: "5.0.0", versions: ["5.0.0"] }),
    NOW,
  );
  const input = [active, archived, old];

  assert.deepEqual(
    sortPackages(input, "name").map((item) => item.name),
    ["alpha", "beta", "zeta"],
  );
  assert.deepEqual(
    sortPackages(input, "age").map((item) => item.name),
    ["alpha", "beta", "zeta"],
  );
  assert.deepEqual(
    sortPackages(input, "status").map((item) => item.name),
    ["zeta", "alpha", "beta"],
  );
  assert.deepEqual(
    input.map((item) => item.name),
    ["beta", "zeta", "alpha"],
  );
});

test("analyzePackageUpdate marks patch and minor upgrades as safe", () => {
  const patch = analyzePackageUpdate(
    dependency("^5.0.0"),
    registry({ latestVersion: "5.0.1", versions: ["5.0.0", "5.0.1"] }),
  );
  const minor = analyzePackageUpdate(
    dependency("^5.0.0"),
    registry({ latestVersion: "5.1.0", versions: ["5.0.0", "5.1.0"] }),
  );

  assert.equal(patch.updateType, "patch");
  assert.equal(patch.commandGroup, "safe");
  assert.equal(minor.updateType, "minor");
  assert.equal(minor.commandGroup, "safe");
});

test("analyzePackageUpdate marks major ESM-only upgrades as risky", () => {
  const result = analyzePackageUpdate(
    dependency("^4.1.0"),
    registry({
      latestVersion: "5.0.0",
      esmOnlyLatest: true,
      versions: ["4.1.0", "5.0.0"],
    }),
  );

  assert.equal(result.updateType, "major");
  assert.equal(result.commandGroup, "risky");
  assert.equal(result.safeLabel, "⚠ ESM only");
});

test("analyzePackageUpdate reports current and unknown versions distinctly", () => {
  const current = analyzePackageUpdate(
    dependency("^5.0.0"),
    registry({ latestVersion: "5.0.0", versions: ["5.0.0"] }),
  );
  const unknown = analyzePackageUpdate(
    dependency("npm:chalk@5"),
    registry({ latestVersion: "5.3.0", versions: ["5.3.0"] }),
  );

  assert.equal(current.updateType, "current");
  assert.equal(current.commandGroup, "none");
  assert.equal(unknown.updateType, "unknown");
  assert.equal(unknown.commandGroup, "risky");
});

test("summarizePackages counts statuses and major updates", () => {
  const deprecated = analyzePackage(
    dependency("^5.0.0"),
    registry({ latestVersion: "5.0.0", deprecatedMessage: "migrate", versions: ["5.0.0"] }),
    NOW,
  );
  const archived = analyzePackage(
    dependency("^5.0.0"),
    registry({ latestVersion: "5.0.0", archived: true, versions: ["5.0.0"] }),
    NOW,
  );
  const unmaintained = analyzePackage(
    dependency("^5.0.0"),
    registry({
      latestVersion: "5.0.0",
      latestReleaseDate: "2023-01-01T00:00:00.000Z",
      versions: ["5.0.0"],
    }),
    NOW,
  );
  const old = analyzePackage(
    dependency("^4.0.0"),
    registry({
      latestVersion: "6.0.0",
      latestReleaseDate: "2025-08-01T00:00:00.000Z",
      versions: ["4.0.0", "6.0.0"],
    }),
    NOW,
  );

  assert.deepEqual(summarizePackages([deprecated, archived, unmaintained, old]), {
    deprecated: 1,
    archived: 1,
    unmaintained: 1,
    old: 1,
    majorUpdates: 1,
  });
});
