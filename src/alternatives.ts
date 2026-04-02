export interface PackageAlternative {
  name: string;
  suggestions: string[];
  reason: string;
}

const ALTERNATIVES: Record<string, PackageAlternative> = {
  lodash: {
    name: "lodash",
    suggestions: ["native ES2023 methods"],
    reason: "most common collection and object helpers are built into modern JavaScript",
  },
  moment: {
    name: "moment",
    suggestions: ["dayjs", "date-fns"],
    reason: "moment is in maintenance mode and newer date libraries are smaller",
  },
  request: {
    name: "request",
    suggestions: ["node-fetch", "axios"],
    reason: "request is deprecated",
  },
  uuid: {
    name: "uuid",
    suggestions: ["crypto.randomUUID()"],
    reason: "Node 15+ includes UUID generation in the standard library",
  },
};

export function lookupAlternative(packageName: string): PackageAlternative | null {
  return ALTERNATIVES[packageName] ?? null;
}

export function hasAlternative(packageName: string): boolean {
  return packageName in ALTERNATIVES;
}
