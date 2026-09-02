import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, closeSync, constants, fstatSync, lstatSync, openSync, readSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

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
// is, whether any directory on the way to it can be written by somebody else, which interpreter its
// shebang will hand it to, and -- on macOS, when the platform will say -- who signed it. Every field
// is about the file. None of them is, or could be, the credential: nothing here ever reads a secret,
// so nothing here can record one.
//
// A name is resolved once. Everything after that reads the *open descriptor*, because a name
// resolved twice is two answers: an earlier round stat'd the path, decided it was acceptable, and
// then opened the same path to hash it, so an attacker who won the gap between the two got a
// fingerprint of one file recorded against the permissions of another. `openSync` first, `fstatSync`
// on the handle, `readSync` through the handle -- and the only remaining pathname reads, `codesign`
// and `ls -lde`, which take names and not descriptors, are followed by a check that the name still
// reaches the same inode.

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

/** Never longer than this. A signature or ACL tool that hangs must not hang the run. */
const TOOL_TIMEOUT_MS = 4000;
const CODESIGN = "/usr/bin/codesign";
const LS = "/bin/ls";

const FINGERPRINT_CHUNK = 1024 * 1024;
const CACHE_LIMIT = 512;
// Keyed by inode identity *and* ctime, which the kernel sets on every write, chmod, chown and ACL
// edit and which `utimes` cannot forge. Without the cache a 360 MB runtime is re-hashed once per
// stage; with a cache keyed only on mtime, a replacement that restored the timestamp would be read
// as unchanged.
const fingerprints = new Map();
const signatures = new Map();
const acls = new Map();

const remember = (cache, key, value) => {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
};

/** The cache key for a file, from a stat taken of the thing itself and not of a name. */
const inodeKey = (stat) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

/** Whether two stats describe the same file at the same moment in its history. */
const sameFile = (a, b) =>
  a !== null && b !== null &&
  a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

const statOrNull = (path) => {
  try {
    return statSync(path);
  } catch {
    return null;
  }
};

/**
 * SHA-256 over the bytes behind an open descriptor.
 *
 * The descriptor, not the path. Reopening by name here is the pathname race this module exists to
 * refuse: the handle is bound to one inode for as long as it is held, and a rename underneath it
 * changes what the *name* reaches without changing what this reads.
 */
const fingerprintOf = (descriptor, stat) => {
  const key = inodeKey(stat);
  const cached = fingerprints.get(key);
  if (cached !== undefined) return cached;
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(FINGERPRINT_CHUNK);
  // Positioned reads, so the descriptor's own offset is left where the caller found it and the
  // shebang read below can share the same handle.
  let position = 0;
  for (;;) {
    const read = readSync(descriptor, buffer, 0, FINGERPRINT_CHUNK, position);
    if (read <= 0) break;
    hash.update(buffer.subarray(0, read));
    position += read;
  }
  return remember(fingerprints, key, `sha256:${hash.digest("hex")}`);
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
 *
 * Executability is asked of the kernel with `access(X_OK)` rather than read off the mode bits. A
 * file with mode 0711 owned by another account has an execute bit and is not executable by this
 * process; `execvp` skips it and carries on down PATH, so a check that stopped at the mode would
 * have described a file the child would never have run.
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
      // So is a relative one: `PATH=bin:/usr/bin` searches the child's own cwd, and AOS would be
      // verifying whatever that same relative name reaches from *here*.
      if (!isAbsolute(directory)) continue;
      candidates.push(join(directory, command));
    }
  }
  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate);
      if (!stat.isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return { path: candidate, realpath: realpathSync(candidate) };
    } catch {}
  }
  return null;
}

/** Every directory from this one to the root, nearest first. */
const ancestorsOf = (start) => {
  const list = [];
  let current = start;
  for (;;) {
    list.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return list;
};

const MAX_CHAIN = 64;

/**
 * Every name that gets a vote in what this command finally executes.
 *
 * Not just the two ends. `/safe/claude -> /bridge/hop -> /trusted/real-claude` has a middle: whoever
 * can write `/bridge` repoints `/bridge/hop` and the run reaches their file, while `/safe` and
 * `/trusted` both stay exactly as verified. An earlier round walked the first link and the final
 * target and never looked at the hop between them, so a world-writable `/bridge` was invisible.
 *
 * A directory *component* that is a symlink counts for the same reason -- `/safe/bin -> /bridge/bin`
 * puts the same power in the same hands one level up -- so each component that is itself a link is
 * pushed back through the walk as a target of its own.
 */
const executableChain = (...starts) => {
  const pending = [...starts];
  const seen = new Set();
  const chain = [];
  while (pending.length > 0 && chain.length < MAX_CHAIN) {
    const target = pending.shift();
    if (seen.has(target)) continue;
    seen.add(target);
    chain.push(target);
    let link = null;
    try {
      link = lstatSync(target);
    } catch {}
    if (link !== null && link.isSymbolicLink()) {
      try {
        const next = readlinkSync(target);
        pending.push(isAbsolute(next) ? next : join(dirname(target), next));
      } catch {}
    }
    for (const directory of ancestorsOf(dirname(target))) {
      if (seen.has(directory)) continue;
      let componentLink = null;
      try {
        componentLink = lstatSync(directory);
      } catch {
        continue;
      }
      if (componentLink.isSymbolicLink()) pending.push(directory);
    }
  }
  return chain;
};

/**
 * What is wrong with one directory, given whether it is the one holding the file.
 *
 * The sticky bit is honoured above the holder -- `/tmp` is world-writable by design and its sticky
 * bit stops anyone renaming an entry they do not own -- but not for the directory holding the
 * executable itself, because `/tmp/claude` is precisely the case this refuses.
 */
const directoryRiskOf = (path, immediate, uid) => {
  const risks = [];
  const stat = statOrNull(path);
  if (stat === null) return [{ path, reason: "unreadable" }];
  const sticky = (stat.mode & 0o1000) !== 0 && !immediate;
  if ((stat.mode & 0o002) !== 0 && !sticky) risks.push({ path, reason: "world_writable" });
  else if ((stat.mode & 0o020) !== 0 && !TRUSTED_DIRECTORY_GIDS.has(stat.gid) && !sticky) {
    risks.push({ path, reason: "group_writable" });
  }
  // A directory owned by a third account can be chmodded open by that account whenever it likes,
  // so its current mode says nothing about what it will be at spawn time.
  if (stat.uid !== 0 && uid !== null && stat.uid !== uid) risks.push({ path, reason: "foreign_owner" });
  return risks;
};

/** Permissions in a macOS ACL that let the holder put a different file where this one is. */
const REPLACEABLE = new Set(["write", "append", "add_file", "add_subdirectory", "delete", "delete_child", "writeextattr"]);

/**
 * Who macOS lets write here that the mode bits do not mention.
 *
 * A directory can sit at 0755, owned by the operator, and still carry `user:someone allow add_file,
 * delete_child`. Node has no interface to an ACL, and the mode-bit walk above reads such a directory
 * as clean -- so the executable under it is one `mv` away from being somebody else's, with every
 * recorded field unchanged. `/bin/ls -lde` is the only thing on the box that will say so.
 *
 * Only `allow` entries count; a `deny` entry takes permission away, and `group:everyone deny delete`
 * sits on half the directories in a home folder. Every allow entry that could put a different file
 * here is reported, including one naming the operator's own account: this module does not get to
 * decide that an ACL somebody added on purpose is the harmless kind, and `--allow-runtime-auth` is
 * where an operator says so themselves.
 */
const aclRisksOf = (paths, platform) => {
  const risks = [];
  if (platform !== "darwin" || paths.length === 0) return risks;
  const unknown = [];
  for (const path of paths) {
    const stat = statOrNull(path);
    // Unreadable is already a finding of its own from the mode walk; nothing to add here.
    if (stat === null) continue;
    const key = inodeKey(stat);
    const cached = acls.get(key);
    if (cached === undefined) unknown.push({ path, key });
    else if (cached !== null) risks.push({ path, reason: "acl_writable", detail: cached });
  }
  if (unknown.length === 0) return risks;
  // One call for the whole chain. A subprocess per directory would widen the window between this
  // check and the spawn, which is what every other decision here is trying to keep narrow.
  let output = "";
  try {
    const result = spawnSync(LS, ["-lde", ...unknown.map((entry) => entry.path)], {
      encoding: "utf8", timeout: TOOL_TIMEOUT_MS
    });
    if (!result.error) output = `${result.stdout ?? ""}`;
  } catch {}
  const found = new Map(unknown.map((entry) => [entry.path, []]));
  let current = null;
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    if (/^\s+\d+:/.test(line)) {
      if (current === null) continue;
      const tokens = line.trim().replace(/^\d+:\s*/, "").split(/\s+/);
      const verdict = tokens.findIndex((token) => token === "allow" || token === "deny");
      if (verdict <= 0 || tokens[verdict] !== "allow") continue;
      const principal = tokens.slice(0, verdict).filter((token) => token !== "inherited").join(" ");
      const permissions = (tokens[verdict + 1] ?? "").split(",");
      if (!permissions.some((permission) => REPLACEABLE.has(permission))) continue;
      found.get(current).push(`${principal} allow ${permissions.join(",")}`);
      continue;
    }
    // A header line ends with the operand it describes. Longest match, because `/usr/bin` also ends
    // with `/bin` and the shorter operand would otherwise steal the longer one's entries.
    let matched = null;
    for (const entry of unknown) {
      if (!line.endsWith(entry.path)) continue;
      if (matched === null || entry.path.length > matched.length) matched = entry.path;
    }
    current = matched;
  }
  for (const entry of unknown) {
    const entries = found.get(entry.path);
    const detail = entries.length > 0 ? entries.join("; ") : null;
    remember(acls, entry.key, detail);
    if (detail !== null) risks.push({ path: entry.path, reason: "acl_writable", detail });
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
const platformIdentityOf = (path, platform, stat) => {
  const absent = { macos_codesign_team: null, macos_requirement_digest: null, recorded: false };
  if (platform !== "darwin") return absent;
  const key = inodeKey(stat);
  const cached = signatures.get(key);
  if (cached !== undefined) return cached;
  try {
    statSync(CODESIGN);
  } catch {
    return absent;
  }
  const run = (args) => {
    try {
      const result = spawnSync(CODESIGN, args, { encoding: "utf8", timeout: TOOL_TIMEOUT_MS });
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
  return remember(signatures, key, {
    macos_codesign_team: named,
    macos_requirement_digest: designated ? `sha256:${sha256Text(designated)}` : null,
    recorded: named !== null || designated !== null
  });
};

const SHEBANG_BYTES = 512;

/**
 * The interpreter line, read off the same descriptor the fingerprint came from.
 *
 * A script does not run itself. `#!/usr/bin/env node` makes the kernel exec `/usr/bin/env`, which
 * then searches the child's PATH for `node` -- and the credential is already in that child's
 * environment by then. So a verified, byte-identical, root-owned `claude` script hands the
 * operator's token to whatever `node` resolves to, with nothing about the script changed. The
 * shebang is part of the identity for the same reason the realpath is.
 */
const shebangOf = (descriptor) => {
  const buffer = Buffer.allocUnsafe(SHEBANG_BYTES);
  let read = 0;
  try {
    read = readSync(descriptor, buffer, 0, SHEBANG_BYTES, 0);
  } catch {
    return null;
  }
  if (read < 3 || buffer[0] !== 0x23 || buffer[1] !== 0x21) return null;
  const line = buffer.subarray(2, read).toString("latin1").split(/[\r\n]/)[0].trim();
  if (line.length === 0) return null;
  const parts = line.split(/\s+/);
  return { program: parts[0], args: parts.slice(1) };
};

/** How deep a shebang chain is followed: a script interpreted by a script interpreted by a script. */
const MAX_INTERPRETER_DEPTH = 4;

const interpreterCommandsOf = (shebang) => {
  if (shebang === null) return [];
  const commands = [shebang.program];
  // `env` is the whole point of the attack: its job is a PATH lookup, so the name it looks up is a
  // second program nobody verified. Its own flags and `NAME=value` assignments are not that name.
  if (basename(shebang.program) !== "env") return commands;
  for (const argument of shebang.args) {
    if (argument.startsWith("-") || argument.includes("=")) continue;
    commands.push(argument);
    break;
  }
  return commands;
};

/** The fields that say which program this is. `identity_digest` is not in its own input. */
export const identityDigestOf = (identity) =>
  `sha256:${sha256Value({
    schema_id: identity.schema_id,
    resolved_realpath: identity.resolved_realpath,
    realpath_digest: identity.realpath_digest,
    file_fingerprint: identity.file_fingerprint,
    interpreter_digest: identity.interpreter_digest,
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
  now = () => new Date().toISOString(),
  depth = 0
} = {}) {
  const resolved = resolveExecutable(command, { env });
  if (resolved === null) return null;
  // The handle first. Every field below is read from it, so they all describe one inode rather than
  // whatever the name reached at the moment each of them happened to look.
  let descriptor;
  try {
    descriptor = openSync(resolved.realpath, "r");
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) return null;

    // Every name with a vote in this, and the directory holding each of them.
    const chain = executableChain(resolved.path, resolved.realpath);
    const audited = [];
    const seenDirectory = new Set();
    for (const target of chain) {
      ancestorsOf(dirname(target)).forEach((path, index) => {
        const key = `${path} ${index === 0}`;
        if (seenDirectory.has(key)) return;
        seenDirectory.add(key);
        audited.push({ path, immediate: index === 0 });
      });
    }
    const risks = [];
    const seenRisk = new Set();
    const record = (risk) => {
      const key = `${risk.reason} ${risk.path}`;
      if (seenRisk.has(key)) return;
      seenRisk.add(key);
      risks.push(risk);
    };
    for (const { path, immediate } of audited) for (const risk of directoryRiskOf(path, immediate, uid)) record(risk);
    for (const risk of aclRisksOf([...new Set([...audited.map((entry) => entry.path), ...chain])], platform)) record(risk);
    const reasons = risks.map((risk) => `${risk.reason} ${risk.path}${risk.detail ? ` (${risk.detail})` : ""}`);
    // The file itself, on the same terms as the directories above it.
    if (stat.uid !== 0 && uid !== null && stat.uid !== uid) reasons.push(`foreign_owner ${resolved.realpath}`);
    if ((stat.mode & 0o002) !== 0) reasons.push(`world_writable ${resolved.realpath}`);
    else if ((stat.mode & 0o020) !== 0 && !TRUSTED_DIRECTORY_GIDS.has(stat.gid)) {
      reasons.push(`group_writable ${resolved.realpath}`);
    }

    const fingerprint = fingerprintOf(descriptor, stat);
    const interpreterChain = [];
    for (const interpreterCommand of depth < MAX_INTERPRETER_DEPTH ? interpreterCommandsOf(shebangOf(descriptor)) : []) {
      const interpreter = describeExecutable(interpreterCommand, { env, platform, adapterId: null, uid, now, depth: depth + 1 });
      if (interpreter === null) {
        // A shebang naming something this process cannot resolve is not "no interpreter". It is an
        // interpreter AOS cannot vouch for, and a credential is the thing at stake.
        interpreterChain.push({ command: interpreterCommand, identity_digest: null });
        reasons.push(`interpreter_unresolved ${interpreterCommand}`);
        continue;
      }
      interpreterChain.push({ command: interpreterCommand, identity_digest: interpreter.identity_digest });
      for (const reason of interpreter.untrusted_reasons) reasons.push(`interpreter ${reason}`);
    }

    const platformIdentity = platformIdentityOf(resolved.realpath, platform, stat);
    // `codesign` and `ls` were handed a pathname, because neither takes a descriptor. If that name
    // no longer reaches the file this handle holds, then the signature and the ACLs describe
    // something else and there is no identity here to report.
    if (!sameFile(stat, statOrNull(resolved.realpath))) return null;

    const identity = {
      schema_id: IDENTITY_SCHEMA,
      command_input: command,
      resolved_realpath: resolved.realpath,
      realpath_digest: `sha256:${sha256Text(resolved.realpath)}`,
      file_fingerprint: fingerprint,
      // One scalar for the whole shebang chain, so a changed interpreter is drift by the same
      // comparison that catches changed bytes. The chain itself is kept beside it for the operator.
      interpreter_digest: interpreterChain.length === 0 ? null : `sha256:${sha256Value(interpreterChain)}`,
      interpreter_chain: interpreterChain,
      owner_uid: stat.uid,
      mode: octal(stat.mode),
      parent_security: {
        world_writable: risks.some((risk) => risk.reason === "world_writable"),
        group_writable_untrusted: risks.some((risk) => risk.reason === "group_writable"),
        foreign_owner: risks.some((risk) => risk.reason === "foreign_owner" || risk.reason === "unreadable"),
        acl_writable: risks.some((risk) => risk.reason === "acl_writable")
      },
      platform_identity: platformIdentity,
      adapter_id: adapterId,
      identity_status: reasons.length === 0 ? "VERIFIED" : "UNTRUSTED",
      // Explanatory, and deliberately outside the digest: these are absolute paths on one machine,
      // and what a comparison is entitled to notice is the four booleans above them.
      untrusted_reasons: [...new Set(reasons)].sort(),
      verified_at: now()
    };
    return { ...identity, identity_digest: identityDigestOf(identity) };
  } finally {
    closeSync(descriptor);
  }
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
  for (const field of ["resolved_realpath", "realpath_digest", "file_fingerprint", "interpreter_digest", "owner_uid", "mode", "adapter_id"]) {
    if (registered[field] !== current[field]) drifted.push(field);
  }
  for (const field of ["world_writable", "group_writable_untrusted", "foreign_owner", "acl_writable"]) {
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
