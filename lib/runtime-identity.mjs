import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

import { sha256Text, sha256Value } from "./core.mjs";

// Which program the credential is actually going to.
//
// The check this replaces compared basenames. An adapter said "only `claude` may receive this", the
// configured command ended in `/claude`, and that was the whole test -- so a script of that name
// anywhere on PATH was handed a real `CLAUDE_CODE_OAUTH_TOKEN` read out of the operator's login
// Keychain. A name is not an identity. The same name survives the binary being rewritten in place,
// the path becoming a symlink to somewhere else, and a wrapper appearing earlier on PATH, and none
// of those is the program the operator granted the credential to.
//
// So an identity is recorded when the agent is registered and recomputed before the credential is
// looked up: where the name resolves to now, what the bytes hash to now, who owns it, what its mode
// is, whether any directory on the way to it can be written by somebody else, and -- on macOS, when
// the platform will say -- who signed it. Every field is about the file. None of them is, or could
// be, the credential: nothing here ever reads a secret, so nothing here can record one.

export const IDENTITY_SCHEMA = "aos-runtime-identity.v1";

/**
 * Groups whose write access to a directory is not a finding.
 *
 * Only root's. The temptation is to add the operator's own login group, which on macOS is `staff`
 * and on most Linux installs is a per-user group -- but `staff` holds every local account on the
 * machine, so trusting it would mean any other account could swap the binary between the check and
 * the spawn. A Homebrew prefix under `/usr/local` is group-writable by `admin` for the same reason
 * and gets the same answer: not trusted for an automatic credential. `--allow-runtime-auth` is the
 * door for an operator who has looked at their own install and decided otherwise.
 */
export const TRUSTED_DIRECTORY_GIDS = new Set([0]);

/** Never longer than this. A signature tool that hangs must not hang the run. */
const CODESIGN_TIMEOUT_MS = 4000;
const CODESIGN = "/usr/bin/codesign";

const FINGERPRINT_CHUNK = 1024 * 1024;
const FINGERPRINT_CACHE_LIMIT = 512;
// Keyed by inode identity *and* ctime, which the kernel sets on every write, chmod and chown and
// which `utimes` cannot forge. Without the cache a 360 MB runtime is re-hashed once per stage; with
// a cache keyed only on mtime, a replacement that restored the timestamp would be read as unchanged.
const fingerprints = new Map();

const fingerprintOf = (path, stat) => {
  const key = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = fingerprints.get(key);
  if (cached !== undefined) return cached;
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(FINGERPRINT_CHUNK);
  const descriptor = openSync(path, "r");
  try {
    for (;;) {
      const read = readSync(descriptor, buffer, 0, FINGERPRINT_CHUNK, null);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(descriptor);
  }
  const digest = `sha256:${hash.digest("hex")}`;
  if (fingerprints.size >= FINGERPRINT_CACHE_LIMIT) fingerprints.clear();
  fingerprints.set(key, digest);
  return digest;
};

const octal = (mode) => (mode & 0o7777).toString(8).padStart(4, "0");

/**
 * Where this command resolves, the way the child process will resolve it.
 *
 * A bare name is searched along PATH and the first executable regular file wins, which is what
 * `execvp` does and therefore what a wrapper dropped earlier on PATH exploits. An absolute path is
 * taken as given. A relative path with a slash in it is refused outright rather than guessed at:
 * the child resolves it against its own working directory -- the workspace, not this process's cwd
 * -- so anything AOS verified here would be a statement about a different file.
 */
export function resolveExecutable(command, { env = process.env } = {}) {
  if (typeof command !== "string" || command.length === 0 || command.includes("\0")) return null;
  const candidates = [];
  if (isAbsolute(command)) candidates.push(command);
  else if (command.includes("/")) return null;
  else {
    for (const directory of String(env.PATH ?? "").split(delimiter)) {
      // An empty PATH entry means the current directory, which is the same guess refused above.
      if (!directory) continue;
      candidates.push(join(directory, command));
    }
  }
  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate);
      if (!stat.isFile()) continue;
      if ((stat.mode & 0o111) === 0) continue;
      return { path: candidate, realpath: realpathSync(candidate) };
    } catch {}
  }
  return null;
}

/**
 * Every directory between this file and the root, and what is wrong with any of them.
 *
 * Walking the whole chain rather than only the immediate parent, because a writable ancestor is a
 * writable parent one rename later. The sticky bit is honoured above the parent -- `/tmp` is
 * world-writable by design and its sticky bit stops anyone renaming an entry they do not own -- but
 * not for the directory holding the executable itself, because `/tmp/claude` is precisely the case
 * this refuses.
 */
const directoryRisks = (start, uid) => {
  const risks = [];
  let current = start;
  let immediate = true;
  for (;;) {
    let stat;
    try {
      stat = statSync(current);
    } catch {
      risks.push({ path: current, reason: "unreadable" });
      break;
    }
    const sticky = (stat.mode & 0o1000) !== 0 && !immediate;
    if ((stat.mode & 0o002) !== 0 && !sticky) risks.push({ path: current, reason: "world_writable" });
    else if ((stat.mode & 0o020) !== 0 && !TRUSTED_DIRECTORY_GIDS.has(stat.gid) && !sticky) {
      risks.push({ path: current, reason: "group_writable" });
    }
    // A directory owned by a third account can be chmodded open by that account whenever it likes,
    // so its current mode says nothing about what it will be at spawn time.
    if (stat.uid !== 0 && uid !== null && stat.uid !== uid) risks.push({ path: current, reason: "foreign_owner" });
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
    immediate = false;
  }
  return risks;
};

/**
 * What macOS will say about who signed this, or nothing.
 *
 * Absence is recorded as absence. A Homebrew shell script and a notarised application both come
 * back with no team identifier here, and reading that as "signature check passed" would turn the
 * one field that could distinguish a vendor build from a replacement into a rubber stamp. On Linux,
 * and on a macOS install where `codesign` is not present, `recorded` is false and the two values
 * are null -- which the caller must treat as no evidence, never as evidence of good.
 */
const platformIdentityOf = (path, platform) => {
  const absent = { macos_codesign_team: null, macos_requirement_digest: null, recorded: false };
  if (platform !== "darwin") return absent;
  try {
    statSync(CODESIGN);
  } catch {
    return absent;
  }
  const run = (args) => {
    try {
      const result = spawnSync(CODESIGN, args, { encoding: "utf8", timeout: CODESIGN_TIMEOUT_MS });
      if (result.error || result.status !== 0) return null;
      return `${result.stdout ?? ""}${result.stderr ?? ""}`;
    } catch {
      return null;
    }
  };
  // `-dv --verbose=4` writes to stderr and carries TeamIdentifier; `-r-` prints the designated
  // requirement, which is the part that says which signing identity would still satisfy it.
  const described = run(["-dv", "--verbose=4", path]);
  const requirement = run(["-d", "-r-", path]);
  const team = described?.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null;
  const designated = requirement?.match(/^designated =>\s*(.+)$/m)?.[1]?.trim() ?? null;
  const named = team && team !== "not set" ? team : null;
  return {
    macos_codesign_team: named,
    macos_requirement_digest: designated ? `sha256:${sha256Text(designated)}` : null,
    recorded: named !== null || designated !== null
  };
};

/** The fields that say which program this is. `identity_digest` is not in its own input. */
export const identityDigestOf = (identity) =>
  `sha256:${sha256Value({
    schema_id: identity.schema_id,
    resolved_realpath: identity.resolved_realpath,
    realpath_digest: identity.realpath_digest,
    file_fingerprint: identity.file_fingerprint,
    owner_uid: identity.owner_uid,
    mode: identity.mode,
    parent_security: identity.parent_security,
    platform_identity: {
      macos_codesign_team: identity.platform_identity.macos_codesign_team,
      macos_requirement_digest: identity.platform_identity.macos_requirement_digest
    },
    adapter_id: identity.adapter_id
  })}`;

/**
 * The identity of the executable this command reaches right now, or null if it reaches none.
 *
 * Called twice: once when the agent is registered, and once immediately before a credential would
 * be looked up. The two records are compared field by field, so this function must be a pure
 * reading of the filesystem -- it takes no credential, is given no credential, and has nowhere to
 * put one.
 */
export function describeExecutable(command, {
  env = process.env,
  platform = process.platform,
  adapterId = null,
  uid = typeof process.getuid === "function" ? process.getuid() : null,
  now = () => new Date().toISOString()
} = {}) {
  const resolved = resolveExecutable(command, { env });
  if (resolved === null) return null;
  let stat;
  try {
    stat = statSync(resolved.realpath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  // Both chains. The directory holding the symlink decides who can repoint it, and the directory
  // holding the target decides who can replace what it points at; either one is enough.
  const risks = [
    ...directoryRisks(dirname(resolved.realpath), uid),
    ...(dirname(resolved.path) === dirname(resolved.realpath) ? [] : directoryRisks(dirname(resolved.path), uid))
  ];
  const reasons = risks.map((risk) => `${risk.reason} ${risk.path}`);
  // The file itself, on the same terms as the directories above it.
  if (stat.uid !== 0 && uid !== null && stat.uid !== uid) reasons.push(`foreign_owner ${resolved.realpath}`);
  if ((stat.mode & 0o002) !== 0) reasons.push(`world_writable ${resolved.realpath}`);
  else if ((stat.mode & 0o020) !== 0 && !TRUSTED_DIRECTORY_GIDS.has(stat.gid)) {
    reasons.push(`group_writable ${resolved.realpath}`);
  }

  const identity = {
    schema_id: IDENTITY_SCHEMA,
    command_input: command,
    resolved_realpath: resolved.realpath,
    realpath_digest: `sha256:${sha256Text(resolved.realpath)}`,
    file_fingerprint: fingerprintOf(resolved.realpath, stat),
    owner_uid: stat.uid,
    mode: octal(stat.mode),
    parent_security: {
      world_writable: risks.some((risk) => risk.reason === "world_writable"),
      group_writable_untrusted: risks.some((risk) => risk.reason === "group_writable"),
      foreign_owner: risks.some((risk) => risk.reason === "foreign_owner" || risk.reason === "unreadable")
    },
    platform_identity: platformIdentityOf(resolved.realpath, platform),
    adapter_id: adapterId,
    identity_status: reasons.length === 0 ? "VERIFIED" : "UNTRUSTED",
    // Explanatory, and deliberately outside the digest: these are absolute paths on one machine,
    // and what a comparison is entitled to notice is the three booleans above them.
    untrusted_reasons: [...new Set(reasons)].sort(),
    verified_at: now()
  };
  return { ...identity, identity_digest: identityDigestOf(identity) };
}

/**
 * Which fields of a recorded identity no longer describe the file on disk.
 *
 * Returned as names rather than a boolean because the name is the remediation: `file_fingerprint`
 * alone is an upgrade or a replacement, `resolved_realpath` is a different file entirely, and an
 * operator told only "drift" has to guess which.
 */
export function identityDrift(registered, current) {
  if (!registered || typeof registered !== "object") return ["identity_record"];
  if (!current || typeof current !== "object") return ["resolved_realpath"];
  const drifted = [];
  for (const field of ["resolved_realpath", "realpath_digest", "file_fingerprint", "owner_uid", "mode", "adapter_id"]) {
    if (registered[field] !== current[field]) drifted.push(field);
  }
  for (const field of ["world_writable", "group_writable_untrusted", "foreign_owner"]) {
    if ((registered.parent_security?.[field] ?? null) !== (current.parent_security?.[field] ?? null)) {
      drifted.push(`parent_security.${field}`);
      break;
    }
  }
  // Only when something was recorded. A machine that could not read a signature at registration
  // has no signature to compare, and inventing a match would be the rubber stamp this avoids.
  for (const field of ["macos_codesign_team", "macos_requirement_digest"]) {
    const before = registered.platform_identity?.[field] ?? null;
    if (before === null) continue;
    if (before !== (current.platform_identity?.[field] ?? null)) drifted.push(`platform_identity.${field}`);
  }
  return drifted;
}
