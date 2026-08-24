import { failure, type AosFailure } from "./errors.ts";

/**
 * Supported environment, checked once at entry.
 *
 * macOS and Linux on x64/arm64, Node >=22.18 <25. Windows and WSL are out of scope, and the way to
 * keep them out is to refuse here rather than to add path, quoting and termination branches that
 * nothing exercises. A branch nobody runs is a claim of support nobody verified.
 */

export const SUPPORTED_PLATFORMS: readonly string[] = Object.freeze(["darwin", "linux"]);
export const SUPPORTED_ARCHITECTURES: readonly string[] = Object.freeze(["x64", "arm64"]);
export const SUPPORTED_NODE_RANGE = ">=22.18 <25";

const UNSUPPORTED_PLATFORM_MESSAGE =
  "Agent Operator Score supports macOS and Linux on x64/arm64 only.";

interface NodeVersion {
  readonly major: number;
  readonly minor: number;
}

const parseNodeVersion = (version: string): NodeVersion | null => {
  const match = /^v?(\d+)\.(\d+)\.\d+/.exec(version);
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
  return { major, minor };
};

/** `>=22.18 <25`. 22.17 is refused; 22.18, 23.x and 24.x are accepted; 25.0 is refused. */
export const isSupportedNodeVersion = (version: string): boolean => {
  const parsed = parseNodeVersion(version);
  if (parsed === null) return false;
  if (parsed.major < 22 || parsed.major >= 25) return false;
  if (parsed.major === 22 && parsed.minor < 18) return false;
  return true;
};

export interface PlatformProbe {
  readonly platform: string;
  readonly arch: string;
  readonly nodeVersion: string;
}

/**
 * Returns null when the environment is supported. The caller decides what to do with the failure;
 * this module never exits a process, so it stays testable without spawning one.
 */
export const checkSupportedEnvironment = (probe: PlatformProbe): AosFailure | null => {
  if (!SUPPORTED_PLATFORMS.includes(probe.platform) || !SUPPORTED_ARCHITECTURES.includes(probe.arch)) {
    return failure(
      "AOS_UNSUPPORTED_PLATFORM",
      UNSUPPORTED_PLATFORM_MESSAGE,
      `Run on macOS or Linux with an x64 or arm64 CPU. Detected ${probe.platform}/${probe.arch}.`
    );
  }
  if (!isSupportedNodeVersion(probe.nodeVersion)) {
    return failure(
      "AOS_NODE_VERSION_UNSUPPORTED",
      `Node ${probe.nodeVersion} is outside the supported range ${SUPPORTED_NODE_RANGE}.`,
      `Install a Node release in ${SUPPORTED_NODE_RANGE} and run the command again.`
    );
  }
  return null;
};

export const currentPlatform = (): PlatformProbe => ({
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version
});
