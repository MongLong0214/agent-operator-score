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

/**
 * Whether a name still reaches the file this descriptor holds.
 *
 * Identity and contents: device, inode, size, modification time. Not `ctime`, which the fingerprint
 * cache key above does use and which this deliberately does not -- `ctime` moves when a file is
 * renamed, and an inode that was moved and moved back is the same program. The metadata where
 * `ctime` would matter, the mode and the owner, was read from the descriptor rather than from this
 * stat, so including it here would refuse files that nothing had happened to while catching nothing
 * that device, inode, size and mtime miss.
 */
const stillReaches = (held, named) =>
  held !== null && named !== null &&
  held.dev === named.dev && held.ino === named.ino &&
  held.size === named.size && held.mtimeMs === named.mtimeMs;

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

/** Rights in a macOS ACL that let the holder put a different file where this one is. */
export const REPLACEABLE_RIGHTS = new Set(["write", "append", "add_file", "add_subdirectory", "delete", "delete_child", "writeextattr"]);

/**
 * What `ls -lde` output says about who can put a different file at each of these paths.
 *
 * Split out from the call that produces the output, and exported, because this is the half that can
 * be wrong without anybody noticing. Which rights count and what happens to a path the listing never
 * mentions are both decisions, and a decision that only executes on macOS is a decision no Linux CI
 * ever exercises. Given captured output this is a pure function of text, and it is tested as one.
 *
 * Returns one record per requested path: `detail` names who was granted what, or null, and
 * `unreadable` says the listing had nothing to say about this path -- which is not the same as
 * saying it is clean, because nobody looked.
 */
export function aclFindingsFrom(output, paths, { answered = true } = {}) {
  const found = new Map(paths.map((path) => [path, { entries: [], listed: false }]));
  let current = null;
  for (const line of String(output ?? "").split("\n")) {
    if (line.length === 0) continue;
    if (/^\s+\d+:/.test(line)) {
      if (current === null) continue;
      const tokens = line.trim().replace(/^\d+:\s*/, "").split(/\s+/);
      const verdict = tokens.findIndex((token) => token === "allow" || token === "deny");
      // A deny entry takes permission away. Only an allow entry hands it to somebody.
      if (verdict <= 0 || tokens[verdict] !== "allow") continue;
      const principal = tokens.slice(0, verdict).filter((token) => token !== "inherited").join(" ");
      const rights = (tokens[verdict + 1] ?? "").split(",");
      if (!rights.some((right) => REPLACEABLE_RIGHTS.has(right))) continue;
      found.get(current).entries.push(`${principal} allow ${rights.join(",")}`);
      continue;
    }
    // A header line ends with the operand it describes. Longest match, because `/usr/bin` also ends
    // with `/bin` and the shorter operand would otherwise steal the longer one's entries.
    let matched = null;
    for (const path of paths) {
      if (!line.endsWith(path)) continue;
      if (matched === null || path.length > matched.length) matched = path;
    }
    current = matched;
    if (matched !== null) found.get(matched).listed = true;
  }
  const result = new Map();
  for (const path of paths) {
    const seen = found.get(path);
    // Silence is not a clean result. A tool that did not run, or that never mentioned a path it was
    // asked about, has told this nothing -- and a check that passes hardest exactly when it stopped
    // working is worse than no check, because it reports the same VERIFIED either way.
    const unreadable = !answered || !seen.listed;
    result.set(path, { unreadable, detail: unreadable || seen.entries.length === 0 ? null : seen.entries.join("; ") });
  }
  return result;
}

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
  let answered = false;
  try {
    const result = spawnSync(LS, ["-lde", ...unknown.map((entry) => entry.path)], {
      encoding: "utf8", timeout: TOOL_TIMEOUT_MS
    });
    answered = !result.error;
    if (answered) output = `${result.stdout ?? ""}`;
  } catch {}
  const findings = aclFindingsFrom(output, unknown.map((entry) => entry.path), { answered });
  for (const entry of unknown) {
    const finding = findings.get(entry.path);
    if (finding.unreadable) {
      // Not cached: a tool that timed out once is not a permanent verdict about this inode.
      risks.push({ path: entry.path, reason: "acl_unreadable" });
      continue;
    }
    remember(acls, entry.key, finding.detail);
    if (finding.detail !== null) risks.push({ path: entry.path, reason: "acl_writable", detail: finding.detail });
  }
  return risks;
};

/**
 * What macOS will say about who signed this, or nothing./**
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

/** `env` short options that take a value. `S` takes one and splits it into more arguments. */
const ENV_VALUE_LETTERS = new Set(["u", "C", "P", "S"]);
/** `env` short options that take none. Anything else is unknown, and unknown is refused. */
const ENV_FLAG_LETTERS = new Set(["i", "0", "v"]);
const ENV_LONG_VALUE = new Set(["--unset", "--chdir", "--default-signal", "--block-signal", "--ignore-signal"]);
const ENV_LONG_FLAG = new Set(["--ignore-environment", "--null", "--debug", "--version", "--help", "--list-signal-handling"]);

/**
 * The program `env` would finally exec, given the arguments that followed it on a shebang line.
 *
 * `env` exists to do a PATH lookup, so the name it looks up is a second program nobody verified --
 * but only if this finds the right token. The first version skipped every leading dash and took the
 * next word, and `#!/usr/bin/env -S -u FOO node` gave it `FOO`: the name of a variable being
 * unset, not a program. `-u`, `-C`, `-P` and `-S` all take a value, `-S` splits its value into
 * further arguments and pushes them in front of the rest, and `--` ends the options.
 *
 * Both spellings matter, because the two kernels disagree about shebangs: macOS splits the line at
 * whitespace, Linux hands `env` everything after the first space as one argument -- which is why
 * `-S` exists at all and why a scan has to be able to reopen it.
 *
 * Returns null when it cannot say. Guessing is worse than not answering: the caller turns null into
 * a refusal, and a wrong guess would verify some other file and pass.
 */
export function envProgramOf(args, depth = 0) {
  if (depth > 2) return null;
  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (token === "--") return args[index + 1] ?? null;
    if (token.startsWith("--")) {
      const separator = token.indexOf("=");
      const name = separator === -1 ? token : token.slice(0, separator);
      if (name === "--split-string") {
        const value = separator === -1 ? args[index + 1] : token.slice(separator + 1);
        if (value === undefined) return null;
        const rest = args.slice(index + (separator === -1 ? 2 : 1));
        return envProgramOf([...value.trim().split(/\s+/).filter(Boolean), ...rest], depth + 1);
      }
      if (ENV_LONG_VALUE.has(name)) {
        index += separator === -1 ? 2 : 1;
        continue;
      }
      if (ENV_LONG_FLAG.has(name)) {
        index += 1;
        continue;
      }
      // An option nobody here has heard of may or may not take a value, and either answer can be
      // wrong by exactly one token -- which is the whole bug this function had.
      return null;
    }
    if (token.startsWith("-") && token.length > 1) {
      const letters = token.slice(1);
      let consumesNext = false;
      let split = null;
      let unknown = false;
      for (let position = 0; position < letters.length; position += 1) {
        const letter = letters[position];
        if (!ENV_VALUE_LETTERS.has(letter) && !ENV_FLAG_LETTERS.has(letter)) {
          unknown = true;
          break;
        }
        if (!ENV_VALUE_LETTERS.has(letter)) continue;
        // A value-taking letter swallows the rest of its own token, or the next one: `-uFOO`,
        // `-u FOO`, and `-iu FOO` are the same instruction written three ways.
        const attached = letters.slice(position + 1);
        if (attached.length === 0) consumesNext = true;
        if (letter === "S") {
          const value = attached.length > 0 ? attached : args[index + 1];
          if (value === undefined) return null;
          split = value;
        }
        break;
      }
      if (unknown) return null;
      if (split !== null) {
        const rest = args.slice(index + (consumesNext ? 2 : 1));
        return envProgramOf([...split.trim().split(/\s+/).filter(Boolean), ...rest], depth + 1);
      }
      index += consumesNext ? 2 : 1;
      continue;
    }
    // `NAME=value` assignments come before the program name and are not it.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    return token;
  }
  return null;
}

const interpreterCommandsOf = (shebang) => {
  if (shebang === null) return [];
  const commands = [shebang.program];
  // `env` is the whole point of the attack: its job is a PATH lookup, so the name it looks up is a
  // second program nobody verified.
  if (basename(shebang.program) !== "env") return commands;
  // null stays null. It means the arguments could not be read, which the caller records as an
  // interpreter it cannot vouch for -- not as an `env` invocation that runs nothing.
  commands.push(envProgramOf(shebang.args));
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
  depth = 0,
  // A seam, and the only one in this module. Whether the fields below come from the held descriptor
  // or from re-reading the name is invisible from outside unless something can act in between, and
  // the version of that test which races the filesystem is a test that passes most of the time --
  // which is the one property a guard must not have. So the two points are named: "opened" is after
  // the handle exists and before anything is read through it, "read" is after every descriptor read
  // is done. A test replaces the pathname at the first and puts it back at the second. Production
  // callers pass nothing and this is two calls to an empty function.
  probe = () => {}
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
    // Before the `fstat`, because the `fstat` is itself one of the reads under test: a version that
    // re-stats the name instead has to see a different file here, or the seam proves nothing about
    // it.
    probe("opened");
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
    // Directories and the file itself, never the symlinks between them. `ls -lde` prints a link as
    // `name -> target`, so the line does not end with the operand and the match below would both
    // miss it and hand its entries to whatever the target is -- and macOS does not consult a
    // symlink's own ACL anyway. What decides who can repoint a link is the directory holding it,
    // which is in `audited`.
    for (const risk of aclRisksOf([...new Set([...audited.map((entry) => entry.path), resolved.realpath])], platform)) record(risk);
    const reasons = risks.map((risk) => `${risk.reason} ${risk.path}${risk.detail ? ` (${risk.detail})` : ""}`);
    // The file itself, on the same terms as the directories above it.
    if (stat.uid !== 0 && uid !== null && stat.uid !== uid) reasons.push(`foreign_owner ${resolved.realpath}`);
    if ((stat.mode & 0o002) !== 0) reasons.push(`world_writable ${resolved.realpath}`);
    else if ((stat.mode & 0o020) !== 0 && !TRUSTED_DIRECTORY_GIDS.has(stat.gid)) {
      reasons.push(`group_writable ${resolved.realpath}`);
    }

    const fingerprint = fingerprintOf(descriptor, stat);
    const interpreters = depth < MAX_INTERPRETER_DEPTH ? interpreterCommandsOf(shebangOf(descriptor)) : [];
    probe("read");
    const interpreterChain = [];
    for (const interpreterCommand of interpreters) {
      const interpreter = interpreterCommand === null
        ? null
        : describeExecutable(interpreterCommand, { env, platform, adapterId: null, uid, now, depth: depth + 1 });
      if (interpreter === null) {
        // A shebang naming something this process cannot resolve is not "no interpreter". It is an
        // interpreter AOS cannot vouch for, and a credential is the thing at stake. `null` is the
        // same answer arrived at one step earlier: `env` handed arguments this cannot read.
        const named = interpreterCommand ?? "arguments to env that could not be read";
        interpreterChain.push({ command: named, identity_digest: null });
        reasons.push(`interpreter_unresolved ${named}`);
        continue;
      }
      interpreterChain.push({ command: interpreterCommand, identity_digest: interpreter.identity_digest });
      for (const reason of interpreter.untrusted_reasons) reasons.push(`interpreter ${reason}`);
    }

    const platformIdentity = platformIdentityOf(resolved.realpath, platform, stat);
    // `codesign` and `ls` were handed a pathname, because neither takes a descriptor. If that name
    // no longer reaches the file this handle holds, then the signature and the ACLs describe
    // something else and there is no identity here to report.
    if (!stillReaches(stat, statOrNull(resolved.realpath))) return null;

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

/**
 * The part of a recorded identity a profile is entitled to bind: its digest and its status.
 *
 * The profile used to read `agent.runtime_identity.identity_digest` straight off the stored agent.
 * Any object with that field name was an identity, including one written under some other schema
 * by some other tool, and a digest nobody here computed became the executable half of a cohort
 * key. Binding goes through this so that only a record this contract produced is bound; anything
 * else is a migration the operator has to perform, said as such rather than as a digest.
 */
const DIGESTED_FIELDS = ["resolved_realpath", "realpath_digest", "file_fingerprint", "parent_security", "platform_identity"];

export const boundRuntimeIdentity = (identity) => {
  const unbound = (status) => ({ identity_digest: null, identity_status: status });
  if (!identity || typeof identity !== "object") return unbound("MIGRATION_REQUIRED");
  if (identity.schema_id !== IDENTITY_SCHEMA) return unbound("MIGRATION_REQUIRED");
  if (typeof identity.identity_digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(identity.identity_digest)) return unbound("MIGRATION_REQUIRED");
  if (identity.identity_status !== "VERIFIED" && identity.identity_status !== "UNTRUSTED") return unbound("MIGRATION_REQUIRED");
  // The digest is recomputed from the record's own fields, because until this line the check was
  // "does it have three fields spelled correctly". A hand-written
  // `{schema_id, identity_digest: "sha256:aaa…", identity_status: "VERIFIED"}` satisfied that and
  // became the executable half of a cohort key -- a status this product never established, and a
  // digest describing no file. A record whose digest does not recompute is not a weaker identity;
  // it is a claim about an executable nobody verified, and it is named as such.
  if (DIGESTED_FIELDS.some((field) => identity[field] === undefined || identity[field] === null)) return unbound("UNVERIFIABLE");
  if (identityDigestOf(identity) !== identity.identity_digest) return unbound("UNVERIFIABLE");
  return { identity_digest: identity.identity_digest, identity_status: identity.identity_status };
};

/** The prefix a projection shows for an executable identity: twelve hex digits, or `unverified`. */
export const identityDigestPrefix = (digest) =>
  typeof digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(digest) ? digest.slice("sha256:".length, "sha256:".length + 12) : "unverified";
