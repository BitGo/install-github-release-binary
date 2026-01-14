import type { TargetTriple, TargetDuple } from "./types";
import { none, some, type Option } from "./option";

const ALL_TARGET_TRIPLES: readonly TargetTriple[] = [
  "aarch64-apple-darwin",
  "aarch64-unknown-linux-musl",
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-musl",
] as unknown as readonly TargetTriple[];

// Target duples (Go format OS-architecture combinations)
export const TARGET_DUPLES: readonly TargetDuple[] = [
  "linux-amd64",
  "linux-arm64",
  "darwin-amd64",
  "darwin-arm64",
] as unknown as readonly TargetDuple[];

function architectureLabel(arch: string): string {
  switch (arch) {
    case "arm64":
      return "aarch64";
    case "x64":
      return "x86_64";
    default:
      throw new Error(
        `Unsupported architecture ${arch} -- only aarch64 and x86_64 currently supported`,
      );
  }
}

type PlatformDuple =
  | { vendor: "apple"; operatingSystem: "darwin" }
  | { vendor: "unknown"; operatingSystem: "linux-musl" };

function platformLabel(platform: NodeJS.Platform): PlatformDuple {
  switch (platform) {
    case "darwin":
      return {
        vendor: "apple",
        operatingSystem: "darwin",
      };
    case "linux":
      return {
        vendor: "unknown",
        operatingSystem: "linux-musl",
      };
    default:
      throw new Error(
        `Unsupported platform ${platform} -- only darwin and linux currently supported`,
      );
  }
}

export function getTargetTriple(
  arch: string,
  platform: NodeJS.Platform,
): TargetTriple {
  const architecture = architectureLabel(arch);
  const { vendor, operatingSystem } = platformLabel(platform);
  return `${architecture}-${vendor}-${operatingSystem}` as TargetTriple;
}

/**
 * Get the target duple (e.g. "linux-amd64") for the given architecture and platform
 */
export function getTargetDuple(
  arch: string,
  platform: NodeJS.Platform,
): TargetDuple {
  switch (platform) {
    case "darwin":
      return arch === "arm64" ? "darwin-arm64" as TargetDuple : "darwin-amd64" as TargetDuple;
    case "linux":
      return arch === "arm64" ? "linux-arm64" as TargetDuple : "linux-amd64" as TargetDuple;
    default:
      throw new Error(
        `Unsupported platform ${platform} for target duple conversion`,
      );
  }
}

/**
 * Strip the target triple or target duple suffix from a string
 */
export function stripTargetTriple(value: string): Option<string> {
  // Can't strip away the target triple if nothing else remains
  if (ALL_TARGET_TRIPLES.find((targetTriple) => targetTriple === value)) {
    return none();
  }

  // Can't strip away the target duple if nothing else remains
  if (TARGET_DUPLES.find((targetDuple) => targetDuple === value)) {
    return none();
  }

  // Try to strip traditional target triple format first
  const strippedTriple = ALL_TARGET_TRIPLES.reduce(
    (value, targetTriple) => value.replace(new RegExp(`-${targetTriple}$`), ""),
    value,
  );

  // If the value changed, a target triple was found and stripped
  if (strippedTriple !== value) {
    return some(strippedTriple);
  }

  // Try to strip target duple suffix
  const strippedDuple = TARGET_DUPLES.reduce(
    (value, duple) => value.replace(new RegExp(`-${duple}$`), ""),
    value,
  );

  // If the value changed, a target duple was found and stripped
  if (strippedDuple !== value) {
    return some(strippedDuple);
  }

  // Nothing was stripped, return the original value
  return some(value);
}
