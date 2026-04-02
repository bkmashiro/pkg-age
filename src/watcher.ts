import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AnalyzedPackage, PackageStatus } from "./analyzer.js";

export interface WatchStateFile {
  packages: Record<string, PackageStatus>;
}

export interface WatchStatusChange {
  name: string;
  previousStatus: PackageStatus | null;
  nextStatus: PackageStatus;
  packageResult: AnalyzedPackage;
}

export interface WatcherOptions {
  projectDir: string;
  packageCount: number;
  intervalSeconds: number;
  inspect: () => Promise<AnalyzedPackage[]>;
  stateFilePath?: string;
}

const DEFAULT_STATE_FILE = ".pkg-age-state.json";

export async function runWatcher(options: WatcherOptions): Promise<void> {
  const stateFilePath = options.stateFilePath ?? path.join(options.projectDir, DEFAULT_STATE_FILE);

  console.log(
    `Watching ${options.packageCount} packages for status changes (checking every ${formatIntervalLabel(options.intervalSeconds)})...`,
  );

  let isRunning = false;

  const tick = async (): Promise<void> => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    try {
      const previousState = await readWatchState(stateFilePath);
      const results = await options.inspect();
      const { changes, nextState } = detectWatchStatusChanges(results, previousState.packages);

      for (const change of changes) {
        console.log(formatWatchStatusChange(change, new Date()));
      }

      await writeWatchState(stateFilePath, nextState);
    } finally {
      isRunning = false;
    }
  };

  await tick();
  const timer = setInterval(() => {
    void tick();
  }, options.intervalSeconds * 1000);

  const shutdown = (): void => {
    clearInterval(timer);
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await new Promise<void>(() => {
    // Keep the process alive while the interval watcher is running.
  });
}

export function detectWatchStatusChanges(
  results: AnalyzedPackage[],
  previousState: Record<string, PackageStatus>,
): { changes: WatchStatusChange[]; nextState: Record<string, PackageStatus> } {
  const nextState: Record<string, PackageStatus> = {};
  const changes: WatchStatusChange[] = [];

  for (const result of results) {
    nextState[result.name] = result.status;
    const previousStatus = previousState[result.name] ?? null;

    if (previousStatus !== null && previousStatus !== result.status) {
      changes.push({
        name: result.name,
        previousStatus,
        nextStatus: result.status,
        packageResult: result,
      });
    }
  }

  return { changes, nextState };
}

export function formatWatchStatusChange(change: WatchStatusChange, now: Date): string {
  const previous = change.previousStatus ?? "NEW";
  const timestamp = formatTimestamp(now);
  const detail = describeWatchStatus(change.packageResult);
  return `[${timestamp}] ${change.name}: ${previous} -> ${change.nextStatus}${detail ? ` (${detail})` : ""} 🔔`;
}

export async function readWatchState(stateFilePath: string): Promise<WatchStateFile> {
  try {
    const raw = await readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WatchStateFile>;
    return {
      packages: parsed.packages ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { packages: {} };
    }
    throw error;
  }
}

export async function writeWatchState(
  stateFilePath: string,
  packages: Record<string, PackageStatus>,
): Promise<void> {
  await writeFile(stateFilePath, JSON.stringify({ packages }, null, 2) + "\n", "utf8");
}

function describeWatchStatus(result: AnalyzedPackage): string {
  if (result.status === "deprecated") {
    return result.deprecatedMessage ?? result.statusLabel;
  }
  if (result.status === "unmaintained" && result.ageDays !== null) {
    return `last release ${result.ageDays} days ago`;
  }
  return result.statusLabel;
}

function formatTimestamp(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatIntervalLabel(intervalSeconds: number): string {
  if (intervalSeconds % 86400 === 0) {
    const days = intervalSeconds / 86400;
    return `${days * 24}h`;
  }
  if (intervalSeconds % 3600 === 0) {
    return `${intervalSeconds / 3600}h`;
  }
  if (intervalSeconds % 60 === 0) {
    return `${intervalSeconds / 60}m`;
  }
  return `${intervalSeconds}s`;
}
