import { URL } from "node:url";

import type { RegistryMetadata } from "./analyzer.js";

interface RegistryDocument {
  "dist-tags"?: {
    latest?: string;
  };
  time?: Record<string, string>;
  versions?: Record<
    string,
    {
      deprecated?: string;
      type?: string;
      exports?: unknown;
      main?: string;
      module?: string;
    }
  >;
}

export interface RegistryFetchResult {
  data: RegistryMetadata | null;
  error: string | null;
}

const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const MAX_CONCURRENCY = 5;

export async function fetchRegistryMetadata(packageNames: string[]): Promise<Map<string, RegistryFetchResult>> {
  const results = new Map<string, RegistryFetchResult>();
  let index = 0;

  async function worker(): Promise<void> {
    while (index < packageNames.length) {
      const currentIndex = index;
      index += 1;
      const name = packageNames[currentIndex];
      results.set(name, await fetchSinglePackage(name));
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, packageNames.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchSinglePackage(packageName: string): Promise<RegistryFetchResult> {
  const url = new URL(encodePackageName(packageName), `${REGISTRY_ORIGIN}/`);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return {
        data: null,
        error: `registry request failed with ${response.status}`,
      };
    }

    const document = (await response.json()) as RegistryDocument;
    const latestVersion = document["dist-tags"]?.latest;
    if (!latestVersion) {
      return {
        data: null,
        error: "missing dist-tags.latest",
      };
    }

    const latestVersionDocument = document.versions?.[latestVersion];
    return {
      data: {
        name: packageName,
        latestVersion,
        latestReleaseDate: document.time?.[latestVersion] ?? null,
        deprecatedMessage: latestVersionDocument?.deprecated ?? null,
        archived: false,
        esmOnlyLatest: isEsmOnlyPackage(latestVersionDocument),
        versions: Object.keys(document.versions ?? {}),
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "unknown fetch error",
    };
  }
}

function encodePackageName(packageName: string): string {
  return packageName
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function isEsmOnlyPackage(
  versionDocument:
    | {
        type?: string;
        exports?: unknown;
        main?: string;
        module?: string;
      }
    | undefined,
): boolean {
  if (!versionDocument) {
    return false;
  }

  if (hasRequireCondition(versionDocument.exports) || hasCommonJsEntry(versionDocument.exports)) {
    return false;
  }

  if (typeof versionDocument.main === "string" && versionDocument.main.endsWith(".cjs")) {
    return false;
  }

  if (typeof versionDocument.exports !== "undefined") {
    return versionDocument.type === "module" || hasImportCondition(versionDocument.exports);
  }

  return versionDocument.type === "module";
}

function hasRequireCondition(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "require") {
      return true;
    }
    if (hasRequireCondition(nestedValue)) {
      return true;
    }
  }

  return false;
}

function hasImportCondition(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "import") {
      return true;
    }
    if (hasImportCondition(nestedValue)) {
      return true;
    }
  }

  return false;
}

function hasCommonJsEntry(value: unknown): boolean {
  if (typeof value === "string") {
    return value.endsWith(".cjs");
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value).some((nestedValue) => hasCommonJsEntry(nestedValue));
}
