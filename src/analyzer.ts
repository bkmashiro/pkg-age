export interface RegistryMetadata {
  name: string;
  latestVersion: string;
  latestReleaseDate: string | null;
  deprecatedMessage: string | null;
  archived: boolean;
  esmOnlyLatest: boolean;
  versions: string[];
}

export interface DependencyInput {
  name: string;
  specifier: string;
  section: "dependencies" | "devDependencies";
}

export type PackageStatus = "deprecated" | "archived" | "unmaintained" | "old" | "outdated" | "active";

export interface AnalyzedPackage {
  name: string;
  section: "dependencies" | "devDependencies";
  specifier: string;
  currentVersion: string;
  latestVersion: string;
  latestReleaseDate: string | null;
  ageDays: number | null;
  ageLabel: string;
  majorVersionsBehind: number;
  hasMajorUpdate: boolean;
  status: PackageStatus;
  severity: number;
  deprecatedMessage: string | null;
  archived: boolean;
  statusLabel: string;
}

export interface AnalysisSummary {
  deprecated: number;
  archived: number;
  unmaintained: number;
  old: number;
  majorUpdates: number;
}

export type UpdateType = "current" | "patch" | "minor" | "major" | "unknown";

export interface UpdateAssessment {
  name: string;
  currentVersion: string;
  latestVersion: string;
  updateType: UpdateType;
  safe: boolean;
  safeLabel: string;
  commandGroup: "safe" | "risky" | "none";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OLD_DAYS = 180;
const UNMAINTAINED_DAYS = 730;

export function analyzePackage(
  dependency: DependencyInput,
  registry: RegistryMetadata,
  now = new Date(),
): AnalyzedPackage {
  const currentVersion = normalizeVersionSpecifier(dependency.specifier);
  const installedMajor = parseMajorVersion(currentVersion);
  const latestMajor = parseMajorVersion(registry.latestVersion);
  const majorVersionsBehind =
    installedMajor !== null && latestMajor !== null && latestMajor > installedMajor
      ? latestMajor - installedMajor
      : 0;
  const hasMajorUpdate = majorVersionsBehind > 0;
  const ageDays = registry.latestReleaseDate ? diffDays(now, new Date(registry.latestReleaseDate)) : null;
  const deprecatedMessage = registry.deprecatedMessage;

  let status: PackageStatus = "active";
  let severity = 4;

  if (deprecatedMessage) {
    status = "deprecated";
    severity = 0;
  } else if (registry.archived) {
    status = "archived";
    severity = 1;
  } else if (ageDays !== null && ageDays > UNMAINTAINED_DAYS && !hasMajorUpdate) {
    status = "unmaintained";
    severity = 2;
  } else if (ageDays !== null && ageDays > OLD_DAYS) {
    status = "old";
    severity = 3;
  } else if (hasMajorUpdate) {
    status = "outdated";
    severity = 4;
  }

  return {
    name: dependency.name,
    section: dependency.section,
    specifier: dependency.specifier,
    currentVersion,
    latestVersion: registry.latestVersion,
    latestReleaseDate: registry.latestReleaseDate,
    ageDays,
    ageLabel: formatAge(ageDays),
    majorVersionsBehind,
    hasMajorUpdate,
    status,
    severity,
    deprecatedMessage,
    archived: registry.archived,
    statusLabel: formatStatusLabel(status, {
      ageDays,
      hasMajorUpdate,
      majorVersionsBehind,
      deprecatedMessage,
    }),
  };
}

export function summarizePackages(results: AnalyzedPackage[]): AnalysisSummary {
  return results.reduce<AnalysisSummary>(
    (summary, item) => {
      if (item.status === "deprecated") {
        summary.deprecated += 1;
      }
      if (item.status === "archived") {
        summary.archived += 1;
      }
      if (item.status === "unmaintained") {
        summary.unmaintained += 1;
      }
      if (item.status === "old") {
        summary.old += 1;
      }
      if (item.hasMajorUpdate) {
        summary.majorUpdates += 1;
      }
      return summary;
    },
    { deprecated: 0, archived: 0, unmaintained: 0, old: 0, majorUpdates: 0 },
  );
}

export function analyzePackageUpdate(
  dependency: DependencyInput,
  registry: RegistryMetadata,
): UpdateAssessment {
  const currentVersion = normalizeVersionSpecifier(dependency.specifier);
  const currentSemver = parseSemver(currentVersion);
  const latestSemver = parseSemver(registry.latestVersion);
  const updateType = getUpdateType(currentSemver, latestSemver);

  if (updateType === "current") {
    return {
      name: dependency.name,
      currentVersion,
      latestVersion: registry.latestVersion,
      updateType,
      safe: true,
      safeLabel: "✅ up to date",
      commandGroup: "none",
    };
  }

  if (updateType === "patch" || updateType === "minor") {
    return {
      name: dependency.name,
      currentVersion,
      latestVersion: registry.latestVersion,
      updateType,
      safe: true,
      safeLabel: "✅ safe to upgrade",
      commandGroup: "safe",
    };
  }

  if (updateType === "major") {
    return {
      name: dependency.name,
      currentVersion,
      latestVersion: registry.latestVersion,
      updateType,
      safe: false,
      safeLabel: registry.esmOnlyLatest ? "⚠ ESM only" : "⚠ breaking changes likely",
      commandGroup: "risky",
    };
  }

  return {
    name: dependency.name,
    currentVersion,
    latestVersion: registry.latestVersion,
    updateType,
    safe: false,
    safeLabel: "⚠ review manually",
    commandGroup: "risky",
  };
}

export function sortPackages(results: AnalyzedPackage[], field: "age" | "name" | "status"): AnalyzedPackage[] {
  const copy = [...results];
  copy.sort((left, right) => {
    if (field === "name") {
      return left.name.localeCompare(right.name);
    }
    if (field === "age") {
      return (right.ageDays ?? -1) - (left.ageDays ?? -1) || left.name.localeCompare(right.name);
    }
    return left.severity - right.severity || left.name.localeCompare(right.name);
  });
  return copy;
}

export function formatAge(ageDays: number | null): string {
  if (ageDays === null) {
    return "unknown";
  }
  if (ageDays >= 365) {
    const years = Math.floor(ageDays / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }
  if (ageDays >= 30) {
    const months = Math.floor(ageDays / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  if (ageDays <= 0) {
    return "today";
  }
  return `${ageDays} day${ageDays === 1 ? "" : "s"} ago`;
}

export function normalizeVersionSpecifier(specifier: string): string {
  const match = specifier.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?/);
  return match ? match[0] : specifier.replace(/^[^\d]*/, "");
}

export function parseMajorVersion(version: string): number | null {
  const match = version.match(/^(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function getUpdateType(
  current: { major: number; minor: number; patch: number } | null,
  latest: { major: number; minor: number; patch: number } | null,
): UpdateType {
  if (!current || !latest) {
    return "unknown";
  }
  if (current.major !== latest.major) {
    return "major";
  }
  if (current.minor !== latest.minor) {
    return "minor";
  }
  if (current.patch !== latest.patch) {
    return "patch";
  }
  return "current";
}

function diffDays(now: Date, releaseDate: Date): number {
  return Math.floor((now.getTime() - releaseDate.getTime()) / DAY_MS);
}

function formatStatusLabel(
  status: PackageStatus,
  context: {
    ageDays: number | null;
    hasMajorUpdate: boolean;
    majorVersionsBehind: number;
    deprecatedMessage: string | null;
  },
): string {
  if (status === "deprecated") {
    return context.deprecatedMessage ? `DEPRECATED -> ${context.deprecatedMessage}` : "DEPRECATED";
  }
  if (status === "archived") {
    return "archived";
  }
  if (status === "unmaintained") {
    return "unmaintained (no release in 2+ years)";
  }
  if (status === "old") {
    return context.hasMajorUpdate ? "old (major update available!)" : "old";
  }
  if (status === "outdated") {
    return context.majorVersionsBehind === 1 ? "1 major behind" : `${context.majorVersionsBehind} majors behind`;
  }
  if (context.hasMajorUpdate) {
    return "active (major update available!)";
  }
  return "active";
}
