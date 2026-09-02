// The guards that must be load-bearing, and the test that dies when each one is removed.
//
// A test suite can be green because it covers the code and green because it covers nothing that
// matters. The difference is only visible by breaking something on purpose: if a guard can be
// deleted and every test still passes, then either the guard does nothing or the suite does not
// check it, and both are worth knowing before a number goes out with the product's name on it.
//
// Eleven of these are named in the specification; the rest were added by work that came after it,
// and they earn their place the same way. Each entry says what to break, and which named test is
// expected to notice -- naming the test is the point, because "some test somewhere failed" would be
// satisfied by a typo.
//
// `tests/product/mutation-manifest.test.mjs` keeps this file honest: it runs on every `npm test`
// and fails if a `from` string no longer appears in its file, or names a test that does not exist.
// Without that, a refactor turns a mutation into a silent no-match and the report reads as a pass.

export const GUARDS = [
  {
    guard: "a sequence at its key's indentation is the value",
    reason: "`on:` over `- push` is how most workflows are written; a reader that refused it failed on valid workflows, which is how a pin check gets switched off",
    file: "lib/action-pins.mjs",
    from: "        if (/^-(\\s|$)/.test(rest())) return readBlockSequence(keyIndent);",
    to: "        if (false) return readBlockSequence(keyIndent);",
    test: "tests/product/action-pins.test.mjs",
    name: "a block sequence at its key's own indentation is the key's value, not a second document"
  },
  {
    guard: "an alias is the node it names",
    reason: "an alias that resolves to nothing is a mapping's inherited keys silently vanishing, and answering wrongly is worse than refusing",
    file: "lib/action-pins.mjs",
    from: "    const target = anchors.get(source.slice(from, at));",
    to: "    const target = null;",
    test: "tests/product/action-pins.test.mjs",
    name: "an alias is the node it names, so a merge key cannot hide a reference or a permission"
  },
  {
    guard: "merge keys bring their keys with them",
    reason: "`<<: *defaults` is where a step's action reference and a job's permissions live, and dropping it hides both",
    file: "lib/action-pins.mjs",
    from: "    if (!node.entries.some((entry) => entry.key === \"<<\")) return node;",
    to: "    return node;",
    test: "tests/product/action-pins.test.mjs",
    name: "an alias is the node it names, so a merge key cannot hide a reference or a permission"
  },
  {
    guard: "quoted keys are keys",
    reason: "a quoted key is a real mapping key GitHub honours, and a reader that only knows the bare spelling does not see the mapping at all",
    file: "lib/action-pins.mjs",
    from: "const KEY_TEXT = /^(?:\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^']|'')*'|[^\\s#\"'{}[\\],*&!|>%@`:](?:[^:#]|:(?=\\S))*?)\\s*:(\\s|$)/;",
    to: "const KEY_TEXT = /^(?:[^\\s#\\\"'{}[\\],*&!|>%@`:](?:[^:#]|:(?=\\S))*?)\\s*:(\\s|$)/;",
    test: "tests/product/action-pins.test.mjs",
    name: "the uses spellings GitHub honours are seen, escapes included, and inert text is not"
  },
  {
    guard: "a resolved key is the key",
    reason: "the permission audit read the characters rather than the key, so a job-level \"permissions\" in quotes was no permission at all and the baseline that recorded none still matched",
    file: "lib/action-pins.mjs",
    from: "      const key = character === '\"' ? readDoubleQuoted().value : readSingleQuoted().value;",
    to: "      const key = JSON.stringify(character === '\"' ? readDoubleQuoted().value : readSingleQuoted().value);",
    test: "tests/product/action-pins.test.mjs",
    name: "a quoted permissions key is the same key, so a job cannot gain write access behind quotes"
  },
  {
    guard: "escaped key resolved before it is a key",
    reason: "YAML unescapes \"r\\u0075n\" to run before it is a key, so matching the characters on the line matches something YAML has stopped calling that key",
    file: "lib/action-pins.mjs",
    from: "  if (code.length > 1) return String.fromCodePoint(Number.parseInt(code.slice(1), 16));",
    to: "  if (false) return \"\";",
    test: "tests/product/action-pins.test.mjs",
    name: "a uses key spelled with an escape is seen, and an escaped run key stays inert"
  },
  {
    guard: "flow-mapping uses",
    reason: "`- { uses: attacker/evil@main }` is a step GitHub runs, and a reader that treats braces as text never sees it",
    file: "lib/action-pins.mjs",
    from: "    if (character === \"{\" || character === \"[\") return finishLine(readFlow());",
    to: "    if (false) return finishLine(readFlow());",
    test: "tests/product/action-pins.test.mjs",
    name: "the uses spellings GitHub honours are seen, escapes included, and inert text is not"
  },
  {
    guard: "block scalar measured from its key",
    reason: "a block scalar on a dashed line ends two columns inside the dash, so measuring it from the line swallowed every sibling of that key -- the uses beside it included",
    file: "lib/action-pins.mjs",
    from: "        if (here < indent) break;",
    to: "        if (here <= keyIndent - 2) break;",
    test: "tests/product/action-pins.test.mjs",
    name: "a uses beside a block scalar in the same step is not swallowed by it"
  },
  {
    guard: "explicit keys are keys",
    reason: "`? uses` / `: value` resolves to a uses key GitHub runs, and it can be written as a folded scalar that no single-line pattern can see",
    file: "lib/action-pins.mjs",
    from: "      if (explicitHere()) entries.push(readExplicitEntry(indent));",
    to: "      if (false) entries.push(readExplicitEntry(indent));",
    test: "tests/product/action-pins.test.mjs",
    name: "an explicit key, folded over lines, is still the key it spells"
  },
  {
    guard: "version comment after a flow mapping",
    reason: "the comment sits outside the braces, so losing it turns a correctly pinned reference into a pin with no readable version",
    file: "lib/action-pins.mjs",
    from: "    const carried = node.flow && node.comment && usesCount(node, chain) === 1 ? node.comment : inherited;",
    to: "    const carried = inherited;",
    test: "tests/product/action-pins.test.mjs",
    name: "a version comment after a flow mapping is kept"
  },
  {
    guard: "carriage returns stripped",
    reason: "a workflow written on Windows leaves a carriage return on every value, and an ordinary pinned reference came back unreadable",
    file: "lib/action-pins.mjs",
    from: "  const source = text.replace(/^\\uFEFF/, \"\").replace(/\\r\\n?/g, \"\\n\");",
    to: "  const source = text.replace(/^\\uFEFF/, \"\");",
    test: "tests/product/action-pins.test.mjs",
    name: "a workflow with CRLF line endings reads the same as one without"
  },
  {
    guard: "uses under with: or env: is an input",
    reason: "an input that happens to be called uses is not an action reference, and reporting it was a false positive on valid YAML",
    file: "lib/action-pins.mjs",
    from: "      if (entry.key === \"uses\" && !chain.includes(\"with\") && !chain.includes(\"env\")) {",
    to: "      if (entry.key === \"uses\") {",
    test: "tests/product/action-pins.test.mjs",
    name: "a uses under with: or env: is an input, not an action reference"
  },
  {
    guard: "a refused file fails the check",
    reason: "\"I could not read this file\" and \"this file is clean\" are the two answers that must never look the same",
    file: "lib/action-pins.mjs",
    from: "    return [{ line: Number(/at line (\\d+)/.exec(error.message)?.[1] ?? 1), raw: null, comment: null, form: \"unreadable\" }];",
    to: "    return [];",
    test: "tests/product/action-pins.test.mjs",
    name: "a file the reader cannot read fails the check rather than passing it"
  },
  {
    guard: "supply-chain digest covers the .npmrc",
    reason: "script-shell in a repository .npmrc makes every npm script exit zero without running anything, which decides the outcome while leaving every other hashed byte identical",
    file: "lib/action-pins.mjs",
    from: "  const npmrcBytes = existsSync(npmrc) ? createHash(\"sha256\").update(readFileSync(npmrc)).digest(\"hex\") : \"absent\";",
    to: "  const npmrcBytes = \"absent\";",
    test: "tests/product/action-pins.test.mjs",
    name: "the supply-chain digest covers the verifier, the npm script and the .npmrc that run the check"
  },
  {
    guard: "directory skip list",
    reason: "skipping node_modules and dist by name is skipping the place someone would put it",
    file: "lib/action-pins.mjs",
    from: 'const SKIP_DIRECTORIES = new Set([".git"]);',
    to: 'const SKIP_DIRECTORIES = new Set([".git", "dist", "node_modules"]);',
    test: "tests/product/action-pins.test.mjs",
    name: "discovery finds workflows by shape, and skips .git and symlinks"
  },
  {
    guard: "supply-chain digest covers the verifier",
    reason: "the verifier combines the two results and sets the exit status, so `ok: true` there turns failure into success with every hashed byte unchanged",
    file: "lib/action-pins.mjs",
    from: "  const runnerBytes = createHash(\"sha256\").update(readFileSync(new URL(\"../scripts/verify-action-pins.mjs\", import.meta.url))).digest(\"hex\");",
    to: "  const runnerBytes = \"\";",
    test: "tests/product/action-pins.test.mjs",
    name: "the supply-chain digest covers the verifier, the npm script and the .npmrc that run the check"
  },
  {
    guard: "local reference redirection",
    reason: "a local composite action is a bridge to whatever external action it names",
    file: "lib/action-pins.mjs",
    from: "        if (!target) localMissing.push({ ...where, reason: \"no action.yml at that path\" });",
    to: "        if (!target) { /* skipped */ }",
    test: "tests/product/action-pins.test.mjs",
    name: "a local reference pointing at nothing fails"
  },
  {
    guard: "container image digest",
    reason: "docker://image:latest is attacker-controlled external code on a runner with our credentials",
    file: "lib/action-pins.mjs",
    from: '        if (!IMAGE_DIGEST.test(reference.digest ?? "")) {',
    to: "        if (false) {",
    test: "tests/product/action-pins.test.mjs",
    name: "a container action is external code and needs a digest too"
  },
  {
    guard: "version comment is a version",
    reason: '"definitely v99, trust me" is a comment, not something a reviewer can check',
    file: "lib/action-pins.mjs",
    from: "      if (!use.comment || !versionComment.test(use.comment)) {",
    to: "      if (!use.comment && false) {",
    test: "tests/product/action-pins.test.mjs",
    name: "a comment that is not a version is not a version"
  },
  {
    guard: "unreadable directory reported",
    reason: "a directory the scan cannot read has unknown contents, and unknown is not a pass",
    file: "lib/action-pins.mjs",
    from: '      unreadable.push({ directory: relative(root, directory).split(sep).join("/") || ".", reason: error.code ?? "unreadable" });',
    to: "      return;",
    test: "tests/product/action-pins.test.mjs",
    name: "a directory the scan cannot read is reported, not skipped"
  },
  {
    guard: "supply-chain digest covers the policy",
    reason: "reviewed_actions could change what passes while the digest stayed identical",
    file: "lib/action-pins.mjs",
    from: "  const policyBytes = createHash(\"sha256\").update(JSON.stringify(policy)).digest(\"hex\");",
    to: '  const policyBytes = "";',
    test: "tests/product/action-pins.test.mjs",
    name: "the supply-chain digest covers the policy that decides what passes"
  },
  {
    guard: "full-SHA action reference",
    reason: "a tag is a name whose owner decides which commit it means, at any time and retroactively",
    file: "lib/action-pins.mjs",
    from: "export const ACTION_REF = /^[0-9a-f]{40}$/;",
    to: "export const ACTION_REF = /^[0-9a-fA-Fv.]{2,40}$/;",
    test: "tests/product/action-pins.test.mjs",
    name: "a full lowercase forty-character SHA is the only external reference that passes"
  },
  {
    guard: "composite action discovery",
    reason: "a workflow saying `uses: ./dist` runs dist/action.yml, which can name any external action",
    file: "lib/action-pins.mjs",
    from: "      const isAction = /^action\\.ya?ml$/.test(entry.name);",
    to: '      const isAction = entry.name === "never-matches.yml";',
    test: "tests/product/action-pins.test.mjs",
    name: "a local action is a redirection, not a free pass"
  },
  {
    guard: "unreadable uses: fails closed",
    reason: "a scanner that shrugs at what it cannot parse reports green on the line written to be misunderstood",
    file: "lib/action-pins.mjs",
    from: "        unparsable.push(where);",
    to: "        continue;",
    test: "tests/product/action-pins.test.mjs",
    name: "a uses: line the scanner cannot parse fails rather than being skipped"
  },
  {
    guard: "reviewed action allowlist",
    reason: "a pinned commit from an action nobody looked at is still code nobody looked at",
    file: "lib/action-pins.mjs",
    from: "      if (!reviewed.has(action)) {",
    to: "      if (false) {",
    test: "tests/product/action-pins.test.mjs",
    name: "the allowlist is per action, not per owner"
  },
  {
    guard: "workflow permission drift",
    reason: "a pin refresh that quietly arrives with contents: write is the change this watches for",
    file: "lib/action-pins.mjs",
    from: 'if (before !== after) fail("permission-drift", name, `recorded ${before}, found ${after}`);',
    to: "if (false) fail();",
    test: "tests/product/action-pins.test.mjs",
    name: "a job that quietly gains write access fails"
  },
  {
    guard: "workspace snapshot map is null-prototype",
    reason: "an agent creating a file named __proto__ wrote through to Object.prototype and vanished from the diff",
    file: "lib/safe-fs.mjs",
    from: "  const files = Object.create(null);",
    to: "  const files = {};",
    test: "tests/product/byte-digest.test.mjs",
    name: "a file or directory named __proto__ is a change like any other"
  },
  {
    guard: "refused tree is not artifact identity",
    reason: "a tree carrying a refusal identifies no descendant inside it, so two artifacts differing only there are one digest",
    file: "lib/digest.mjs",
    from: "    if (manifest.refusals.length > 0) {",
    to: "    if (false) {",
    test: "tests/product/byte-digest.test.mjs",
    name: "an artifact whose tree carries a refusal is refused rather than identified"
  },
  {
    guard: "raw artifact name bytes",
    reason: "an artifact name decoded as UTF-8 hands two artifacts whose names differ by one byte on under one digest",
    file: "lib/digest.mjs",
    from: 'const nameBytes = (relative) => (Buffer.isBuffer(relative) ? relative : Buffer.from(String(relative), "utf8"));',
    to: 'const nameBytes = (relative) => Buffer.from(String(relative), "utf8");',
    test: "tests/product/byte-digest.test.mjs",
    name: "an artifact name's raw bytes are its identity"
  },
  {
    guard: "symlink component expansion",
    reason: "a target resolved as one lexical string accepts a link through an ancestor that points out of the tree",
    file: "lib/digest.mjs",
    from: "    if (!stats.isSymbolicLink()) {",
    to: "    if (true) {",
    test: "tests/product/byte-digest.test.mjs",
    name: "a link through a symlinked directory out of the tree is refused"
  },
  {
    guard: "entry state coherence",
    reason: "field alphabets alone accept an unrefused regular file with no byte digest, which is a row that identifies nothing",
    file: "lib/digest.mjs",
    from: "const coherentEntry = (entry) => {",
    to: "const coherentEntry = () => true; const unusedCoherentEntry = (entry) => {",
    test: "tests/product/byte-digest.test.mjs",
    name: "an entry that claims to be a file must carry the digest that identifies it"
  },
  {
    guard: "canonical manifest order and uniqueness",
    reason: "a manifest listing one path twice, or in an order no walk emits, digests to a value nothing can reproduce",
    file: "lib/digest.mjs",
    from: "    if (compareCanonical(manifest.entries[at - 1].path_bytes, manifest.entries[at].path_bytes) >= 0) {",
    to: "    if (false) {",
    test: "tests/product/byte-digest.test.mjs",
    name: "a manifest that lists a path twice, or out of canonical order, is refused"
  },
  {
    guard: "top-level artifact open does not follow",
    reason: "lstat then read is two questions at two moments, and the answer to the first does not bind the second",
    file: "lib/digest.mjs",
    from: "const ARTIFACT_OPEN = constants.O_RDONLY | O_NOFOLLOW | (constants.O_NONBLOCK ?? 0);",
    to: "const ARTIFACT_OPEN = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);",
    test: "tests/product/byte-digest.test.mjs",
    name: "a symlink handed as an artifact is refused, and so is a special file"
  },
  {
    guard: "legacy ledger row is not holdout evidence",
    reason: "a session digest that cannot tell two files apart must not carry a product acceptance decision",
    file: "lib/holdout.mjs",
    from: '    ledger.sessions.filter((entry) => entry.use === "holdout" && isByteDigest(entry.digest)).map((entry) => entry.digest)',
    to: '    ledger.sessions.filter((entry) => entry.use === "holdout").map((entry) => entry.digest)',
    test: "tests/product/byte-digest.test.mjs",
    name: "a session recorded under the legacy identity is not counted, and not hidden either"
  },
  {
    guard: "captured stderr byte authority",
    reason: "an agent that says nothing on stdout and everything on stderr is the ordinary failing one, and a decode there gives two failures one signature",
    file: "lib/core.mjs",
    from: "      stderr_digest: sha256Bytes(stderr),",
    to: '      stderr_digest: sha256Bytes(Buffer.from(stderr.toString("utf8"), "utf8")),',
    test: "tests/product/byte-digest.test.mjs",
    name: "a captured stream digest is over the bytes the agent produced"
  },
  {
    guard: "artifact type in the envelope",
    reason: "without it a regular file and a directory are handed on under one artifact identity",
    file: "lib/digest.mjs",
    from: 'if (stat.isFile()) return sha256Bytes(artifactPreimage("file", stat, relative, digestOf(readFileSync(fd))));',
    to: 'if (stat.isFile()) return sha256Bytes(artifactPreimage("dir", stat, relative, digestOf(readFileSync(fd))));',
    test: "tests/product/byte-digest.test.mjs",
    name: "a file artifact and a directory artifact are different even where their contents digest the same"
  },
  {
    guard: "artifact top-level mode",
    reason: "a script handed on identically at 0644 and 0755 is a digest that cannot see whether the receiver can run it",
    file: "lib/digest.mjs",
    from: '  Buffer.from(`${ARTIFACT_SCHEMA}\\n${type}\\n${modeOf(stats)}\\n${nameBytes(relative).toString("hex")}\\n${digest}\\n`, "utf8");',
    to: '  Buffer.from(`${ARTIFACT_SCHEMA}\\n${type}\\n${nameBytes(relative).toString("hex")}\\n${digest}\\n`, "utf8");',
    test: "tests/product/byte-digest.test.mjs",
    name: "an artifact digest changes when the artifact's own mode changes"
  },
  {
    guard: "refused size in the tree digest",
    reason: "a refusal that dropped the size freezes the evidence for anything large enough to trip the limit",
    file: "lib/digest.mjs",
    from: '  entry.size_bytes === null ? "-" : String(entry.size_bytes),',
    to: '  "-",',
    test: "tests/product/byte-digest.test.mjs",
    name: "a refusal keeps the path, type, mode and size of what it refused"
  },
  {
    guard: "escaping link keeps its own bytes",
    reason: "two links out of the tree to different places become one row, which is a collision inside the refusal",
    file: "lib/digest.mjs",
    from: "          bytes: target,\n          refused: escapes ? SYMLINK_ESCAPES : null",
    to: "          bytes: escapes ? null : target,\n          refused: escapes ? SYMLINK_ESCAPES : null",
    test: "tests/product/byte-digest.test.mjs",
    name: "two links that escape the tree to different places are two different trees"
  },
  {
    guard: "raw link target bytes",
    reason: "readlink decoded as UTF-8 hashes a link to byte FF and a link to byte FE as the same link",
    file: "lib/digest.mjs",
    from: '        const target = readlinkSync(full, { encoding: "buffer" });',
    to: '        const target = Buffer.from(readlinkSync(full), "utf8");',
    test: "tests/product/byte-digest.test.mjs",
    name: "a link target's raw bytes are the link's identity"
  },
  {
    guard: "raw filename bytes",
    // Linux only, and named as such. APFS refuses a filename that is not valid UTF-8, so the case
    // cannot be constructed on macOS and the test returns early there; the mutation job runs on
    // ubuntu, which is where this one is decided.
    reason: "readdir decoded as UTF-8 gives two files whose names differ by one byte a single unreadable-entry row",
    file: "lib/digest.mjs",
    from: '      return readdirSync(directory, { encoding: "buffer" }).sort(Buffer.compare);',
    to: '      return readdirSync(directory).map((name) => Buffer.from(name, "utf8")).sort(Buffer.compare);',
    test: "tests/product/byte-digest.test.mjs",
    name: "a filename's raw bytes are its identity in the tree"
  },
  {
    guard: "symlink chain containment",
    reason: "checking only the first hop accepts a dangling chain whose end is outside the tree",
    file: "lib/digest.mjs",
    from: "    const resolved = resolveChain(directory, target);\n    return resolved !== null && containsBytes(base, resolved);",
    to: "    return true;",
    test: "tests/product/byte-digest.test.mjs",
    name: "a chain of dangling links that leaves the tree is refused"
  },
  {
    guard: "skipped directory is still an entry",
    reason: "dropping the entry as well as the contents makes an empty artifact and one holding a .git the same artifact",
    file: "lib/digest.mjs",
    from: '          refuse(relative, "skipped-directory", { type: "dir", mode: modeOf(stats) });',
    to: "",
    test: "tests/product/byte-digest.test.mjs",
    name: "a skipped directory is an entry even though its contents are not walked"
  },
  {
    guard: "canonical row field alphabet",
    reason: "an exported digest over unchecked fields lets a hand-built manifest forge a row boundary",
    file: "lib/digest.mjs",
    from: '    if (!wellFormedFields(entry) || !coherentEntry(entry)) throw new Error(`AOS_TREE_MANIFEST_ENTRY ${entry?.path ?? "?"}`);',
    to: '    if (!coherentEntry(entry)) throw new Error(`AOS_TREE_MANIFEST_ENTRY ${entry?.path ?? "?"}`);',
    test: "tests/product/byte-digest.test.mjs",
    name: "a manifest whose fields could forge a row boundary is refused rather than hashed"
  },
  {
    guard: "workspace snapshot records directories",
    reason: "an absent directory and an empty one otherwise produce the same snapshot, so mkdir is a change no scope check sees",
    file: "lib/safe-fs.mjs",
    from: "        files[relative] = DIRECTORY;",
    to: "",
    test: "tests/product/byte-digest.test.mjs",
    name: "a workspace snapshot records a directory, so an added empty one is a change"
  },
  {
    guard: "session ledger byte identity",
    reason: "a session read as UTF-8 gives two transcripts differing by one undecodable byte the same ledger identity",
    file: "lib/cli.mjs",
    from: "    const digest = sessionDigestOf(readFileSync(sessionPath));",
    to: '    const digest = sessionDigestOf(Buffer.from(readFileSync(sessionPath, "utf8"), "utf8"));',
    test: "tests/product/byte-digest.test.mjs",
    name: "a recorded session's ledger identity is its bytes"
  },
  {
    guard: "captured stream byte authority",
    reason: "a digest of decoded output gives two different agent outputs the same failure signature",
    file: "lib/core.mjs",
    from: "      stdout_digest: sha256Bytes(stdout),",
    to: '      stdout_digest: sha256Bytes(Buffer.from(stdout.toString("utf8"), "utf8")),',
    test: "tests/product/byte-digest.test.mjs",
    name: "a captured stream digest is over the bytes the agent produced"
  },
  {
    guard: "raw Buffer authority",
    reason: "a digest taken after a UTF-8 decode calls a 0xFF byte and an honest U+FFFD the same file",
    file: "lib/digest.mjs",
    from: '  if (!Buffer.isBuffer(bytes) && !ArrayBuffer.isView(bytes)) throw new Error("AOS_DIGEST_NOT_BYTES");',
    to: "",
    test: "tests/product/byte-digest.test.mjs",
    name: "sha256Bytes digests the buffer it is given and refuses anything that is not one"
  },
  {
    guard: "binary handling",
    reason: "a text projection offered for undecodable bytes is a digest of U+FFFD, which every binary shares",
    file: "lib/digest.mjs",
    from: "const strictDecoder = new TextDecoder(\"utf-8\", { fatal: true, ignoreBOM: true });",
    to: 'const strictDecoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });',
    test: "tests/product/byte-digest.test.mjs",
    name: "a text projection is offered only for bytes that are valid UTF-8"
  },
  {
    guard: "canonical path, type and mode tuple",
    reason: "a tree digest that drops the mode hands on a file made executable as unchanged",
    file: "lib/digest.mjs",
    from: "  entry.mode ?? \"-\",",
    to: '  "-",',
    test: "tests/product/byte-digest.test.mjs",
    name: "a tree digest changes when a mode changes and not when only an mtime does"
  },
  {
    guard: "refusal marker in the tree digest",
    reason: "a refusal left out of the digest lets an agent hide an edit by making the file unreadable",
    file: "lib/digest.mjs",
    from: '  entry.refused === null ? "-" : `refused:${entry.refused}`,',
    to: '  "-",',
    test: "tests/product/byte-digest.test.mjs",
    name: "two refusals of the same entry for different reasons are two different trees"
  },
  {
    guard: "symlink escape refusal",
    reason: "a link followed out of the tree puts files the tree does not contain into its digest",
    file: "lib/digest.mjs",
    from: "        const escapes = !linkTargetInside(base, directory, full, target);",
    to: "        const escapes = false;",
    test: "tests/product/byte-digest.test.mjs",
    name: "a symlink out of the tree is refused rather than digested"
  },
  {
    guard: "handoff exact compare",
    reason: "a consume taken on the receiver's word closes a handoff for an artifact it never read",
    file: "lib/cli.mjs",
    from: "    if (!handoffDigestsMatch(handed, artifacts)) {",
    to: "    if (false) {",
    test: "tests/product/handoff-exact-digest.test.mjs",
    name: "a handoff consumed with a digest that was not handed is refused"
  },
  {
    guard: "legacy digest separation",
    reason: "a bare-hex normalised digest admitted as identity is a claim nobody can verify",
    file: "lib/cli.mjs",
    from: '  if (artifacts.some((value) => !isByteDigest(value))) return fail(io, "AOS_INVALID_ARTIFACT_DIGEST", 2);',
    to: "",
    test: "tests/product/handoff-exact-digest.test.mjs",
    name: "a legacy normalised digest is not accepted as an artifact digest"
  },
  {
    guard: "workspace snapshot reads bytes",
    reason: "a snapshot taken over decoded text reports a CRLF rewrite as an untouched workspace",
    file: "lib/safe-fs.mjs",
    from: "      files[relative] = sha256Bytes(readFileSync(full));",
    to: '      files[relative] = sha256Bytes(Buffer.from(readFileSync(full, "utf8").replace(/\\r\\n/g, "\\n"), "utf8"));',
    test: "tests/product/byte-digest.test.mjs",
    name: "a workspace snapshot sees a line-ending rewrite and a one-byte binary edit"
  },
  {
    guard: "an issue number is a number before it is a pattern",
    reason: "a record carrying \"issue\": \".*\" made pr_closes_issue true against any pull request body",
    file: "lib/github-state.mjs",
    from: "    const number = Number.isInteger(record.issue) && record.issue > 0 ? String(record.issue) : null;",
    to: "    const number = String(record.issue);",
    test: "tests/product/execution-plan.test.mjs",
    name: "an issue number from a comment cannot become a pattern"
  },
  {
    guard: "a phase's predecessors must be in the plan",
    reason: "a phase blocked by #999 was withheld forever and never reported stale once its real predecessor landed",
    file: "lib/execution-plan.mjs",
    from: "        if (!byNumber.has(predecessor)) {\n          fail(\"unknown-dependency\", `#${one.issue} phase \"${phase.id}\" is blocked by #${predecessor}, which is not in the plan`, one.issue);",
    to: "        if (false) {\n          fail(\"unknown-dependency\", `#${one.issue} phase \"${phase.id}\" is blocked by #${predecessor}, which is not in the plan`, one.issue);",
    test: "tests/product/execution-plan.test.mjs",
    name: "a phase blocked by a number outside the plan is refused like an issue would be"
  },
  {
    guard: "a started phase cannot integrate code on a blocked issue",
    reason: "checking only `ready` left the permission reachable by moving the phase forward",
    file: "lib/execution-plan.mjs",
    from: "      if (STARTED.has(phase.status) && one.status !== \"ready\" && phase.code_integration_allowed) {",
    to: '      if (phase.status === "ready" && one.status !== "ready" && phase.code_integration_allowed) { } if (false) {',
    test: "tests/product/execution-plan.test.mjs",
    name: "a phase-ready phase that claims final integration exceeds its scope and fails"
  },
  {
    guard: "an issue owns a surface",
    reason: "owning nothing means no surface is protected from a second writer",
    file: "lib/execution-plan.mjs",
    from: '    if (one.owner_surfaces.length === 0 && one.kind !== "epic") {',
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a non-canonical plan still reports the evidence, ownership and gate failures beside it"
  },
  {
    guard: "a truncated reachability answer is not an answer",
    reason: "returning false on an exhausted budget said `these do not depend on each other` when they do",
    file: "lib/execution-plan.mjs",
    from: '      if (steps > budget) return "unknown";',
    to: "      if (steps > budget) return false;",
    test: "tests/product/execution-plan.test.mjs",
    name: "a reachability answer that ran out of budget is reported, not returned as no"
  },
  {
    guard: "offline runs do not print or report a pass",
    reason: "ok, the exit status and the printed line all said success on a run that established nothing",
    file: "lib/execution-plan.mjs",
    from: "        : reports.evidence.established === true || (reports.evidence.unestablished ?? []).length === 0",
    to: "        : true",
    test: "tests/product/execution-plan.test.mjs",
    name: "an offline run reports INCOMPLETE as its verdict while ok and the exit status stay true"
  },
  {
    guard: "a live audit needs a live snapshot",
    reason: "`{live: true}` over a committed file was a caller's claim that nothing checked",
    file: "lib/execution-plan.mjs",
    from: '  const isLive = live && snapshot.source === "live";',
    to: "  const isLive = live;",
    test: "tests/product/execution-plan.test.mjs",
    name: "a live audit asked for over a committed snapshot is refused, not granted"
  },
  {
    guard: "the evidence contract is pinned outside the plan",
    reason: "required_evidence_fields: [\"x\"] was non-empty and asked for nothing",
    file: "lib/execution-plan.mjs",
    from: "    if (JSON.stringify([...one.required_evidence_fields].sort()) !== JSON.stringify([...contract.fields].sort())) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the evidence contract lives outside the document it checks"
  },
  {
    guard: "phase permissions are pinned, not only phase names",
    reason: "flipping #572's read-only phase to integrate code passed, because the scope rule only fires on a blocked issue",
    file: "lib/execution-plan.mjs",
    from: "      if (phase.code_integration_allowed !== required[phase.id].code_integration_allowed) {",
    to: "      if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the phase contract pins what a phase may do, not only what it is called"
  },
  {
    guard: "owned paths are not only prose",
    reason: "owned_paths: [\"README.md\"] made `changed something it owns` true of a typo fix",
    file: "lib/execution-plan.mjs",
    from: "    if (one.kind !== \"epic\" && one.kind !== \"audit\" && one.owned_paths.every((path) => DOCUMENTATION_ONLY.test(path))) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the evidence contract lives outside the document it checks"
  },
  {
    guard: "independent checks survive a non-canonical plan",
    reason: "an early return here suppressed six checks that need no graph, and a reader needs them in the same run",
    file: "lib/execution-plan.mjs",
    from: "  if (!canonicalShape) {",
    to: "  if (!canonicalShape) { return { ok: false, failures, owners: {} }; } if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a non-canonical plan still reports the evidence, ownership and gate failures beside it"
  },
  {
    guard: "evidence bound to the audited revision",
    reason: "the shipped record quoted a manifest digest that no longer matched, and the audit printed PASS",
    file: "lib/github-state.mjs",
    from: "    checked.evidence_digests_match = results.every(Boolean);",
    to: "    checked.evidence_digests_match = true;",
    test: "tests/product/execution-plan.test.mjs",
    name: "three separately true facts are not a confirmation"
  },
  {
    guard: "the closing pull request changed something the issue owns",
    reason: "a documentation PR saying `Closes #N` produced eight true booleans having done no work",
    file: "lib/github-state.mjs",
    from: "      owned.length > 0 && files.some((one) => owned.some((path) => one.filename === path || one.filename.startsWith(path)));",
    to: "      true;",
    test: "tests/product/execution-plan.test.mjs",
    name: "three separately true facts are not a confirmation"
  },
  {
    guard: "offline does not assert close evidence",
    reason: "the confirmations live in a file the author of the change controls",
    file: "lib/execution-plan.mjs",
    from: "    if (!isLive) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "offline, close evidence is reported as unestablished and never as a failure"
  },
  {
    guard: "evidence contract cannot be switched off",
    reason: "`close_evidence_required: false` was one edit away from disabling the gate that reads it",
    file: "lib/execution-plan.mjs",
    from: "    if (!one.close_evidence_required) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the manifest edits that used to weaken a gate now fail"
  },
  {
    guard: "phases are a contract",
    reason: "emptying #572's phases removed the restriction that withholds branch deletion",
    file: "lib/execution-plan.mjs",
    from: "    if (JSON.stringify(declared) !== JSON.stringify(Object.keys(required).sort())) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the manifest edits that used to weaken a gate now fail"
  },
  {
    guard: "cycle search inside strongly connected components",
    reason: "a dense acyclic graph has zero cycles and exponentially many paths, and the search walked all of them",
    file: "lib/execution-plan.mjs",
    from: "  for (const component of stronglyConnected(byNumber)) {",
    to: "  for (const component of [[...byNumber.keys()]]) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a dense acyclic graph finishes quickly instead of exploring every path"
  },
  {
    guard: "a truncated cycle search says so",
    reason: "a list that stopped early must not read like a complete one",
    file: "lib/execution-plan.mjs",
    from: '  if (cycles.truncated) fail("cycle-search-truncated", "the cycle search hit its bound, so this list is not every cycle");',
    to: "  if (false) fail();",
    test: "tests/product/execution-plan.test.mjs",
    name: "a truncated cycle search says so"
  },
  {
    guard: "the capture time names a day that exists",
    reason: "2026-02-30 parses, and Date silently rolls it over to the second of March",
    file: "lib/execution-plan.mjs",
    from: "  if (d > lengths[mo - 1]) return false;",
    to: "  if (false) return false;",
    test: "tests/product/execution-plan.test.mjs",
    name: "a date with the shape of an instant that is not one fails"
  },
  {
    guard: "one snapshot entry per issue",
    reason: "a Map keeps the last entry, so a second copy answered for the first",
    file: "lib/execution-plan.mjs",
    from: '    if (seen.has(one.number)) fail("snapshot-duplicate-issue", one.number, "the snapshot carries this issue more than once");',
    to: "    if (false) fail();",
    test: "tests/product/execution-plan.test.mjs",
    name: "a snapshot carrying an issue twice fails"
  },
  {
    guard: "close-evidence component confirmations",
    reason: "a one-key `verified: true` was a forgery of the whole live audit",
    file: "lib/execution-plan.mjs",
    from: "      const absent = REQUIRED_CONFIRMATIONS.filter((key) => checked[key] !== true);",
    to: "      const absent = [];",
    test: "tests/product/execution-plan.test.mjs",
    name: "a one-key forgery of the whole audit does not pass"
  },
  {
    guard: "pull request produced the commit",
    reason: "three separately true facts about unrelated work are not a confirmation of this work",
    file: "lib/github-state.mjs",
    from: "    checked.pr_produced_the_commit = pull.merge_commit_sha === record.final_sha || pull.head?.sha === record.final_sha;",
    to: "    checked.pr_produced_the_commit = true;",
    test: "tests/product/execution-plan.test.mjs",
    name: "three separately true facts are not a confirmation"
  },
  {
    guard: "write access asked of the repository",
    reason: "a collaborator with the read or triage role would have attested to completed work",
    file: "lib/github-state.mjs",
    from: "    allowed = WRITE_PERMISSIONS.has(body.permission);",
    to: "    allowed = true;",
    test: "tests/product/execution-plan.test.mjs",
    name: "write access is asked of the repository, not inferred from an association"
  },
  {
    guard: "snapshot source matches how it was read",
    reason: "an offline snapshot stamped `live` reads in the evidence bundle as an audit that talked to GitHub",
    file: "lib/execution-plan.mjs",
    from: "  if (snapshot?.source !== expectedSource) {",
    to: "  if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "an offline snapshot cannot claim to be a live audit, or to be about another branch"
  },
  {
    guard: "done issues have no withheld phase",
    reason: "#572's withheld phase is the one that deletes branches",
    file: "lib/execution-plan.mjs",
    from: '      if (one.status === "done" && phase.status !== "done") {',
    to: "      if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "an issue is not done while one of its phases is withheld"
  },
  {
    guard: "excluded issues present in the snapshot",
    reason: "absence switched the excluded-issue check off from the file it checks",
    file: "lib/execution-plan.mjs",
    from: '      fail("excluded-issue-not-in-snapshot", excluded, "the snapshot does not carry the excluded issue, so its state cannot be checked");',
    to: "      continue;",
    test: "tests/product/execution-plan.test.mjs",
    name: "an excluded issue missing from the snapshot is not a pass"
  },
  {
    guard: "elementary cycle enumeration",
    reason: "a diagnostic that omits the edge someone has to remove sends them to fix the wrong one",
    file: "lib/execution-plan.mjs",
    from: "        if (!inside.has(next) || next < start) continue;",
    to: "        if (!inside.has(next)) continue;",
    test: "tests/product/execution-plan.test.mjs",
    name: "the two-cycles a shared visited set used to drop are each reported once"
  },
  {
    guard: "close-evidence repository confirmation",
    reason: "forty hex characters and a positive integer are things a fabricated record has too",
    file: "lib/execution-plan.mjs",
    from: "    if (checked && checked.verified !== true) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a record the repository does not confirm is not evidence"
  },
  {
    guard: "close-evidence author trust",
    reason: "anyone can comment on a public issue; not everyone can attest that work was done",
    file: "lib/execution-plan.mjs",
    from: "    if (record && record.author_trusted !== true) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a record from someone without write access is not an attestation"
  },
  {
    guard: "snapshot provenance",
    reason: "a branch controlling both the plan and its comparison authority can make them agree on a fiction",
    file: "lib/execution-plan.mjs",
    from: "  if (snapshot?.repository !== plan.repository) {",
    to: "  if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a snapshot that does not say what it is cannot be the comparison authority"
  },
  {
    guard: "started statuses need finished predecessors",
    reason: "constraining only `ready` let an issue be moved to in-progress and then done past its blockers",
    file: "lib/execution-plan.mjs",
    from: "    if (STARTED.has(one.status) && unfinished.length > 0) {",
    to: "    if (one.status === \"ready\" && false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "in-progress and done are constrained by predecessors, not just ready"
  },
  {
    guard: "excluded issues are a floor",
    reason: "a check its own subject can switch off is not a check",
    file: "lib/execution-plan.mjs",
    from: "    if (!plan.excluded_issues.includes(excluded)) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the excluded-issue check cannot be switched off from inside the plan"
  },
  {
    guard: "restricted readiness",
    reason: "advertising #572 as ready is an invitation to delete branches before #578 preserved the evidence",
    file: "lib/execution-plan.mjs",
    from: "  const restricted = openIssues.filter((one) => one.phases.some((phase) => phase.status !== \"ready\"));",
    to: "  const restricted = [];",
    test: "tests/product/execution-plan.test.mjs",
    name: "a ready issue with a blocked phase is advertised as restricted, never as ready"
  },
  {
    guard: "exactly one status label",
    reason: "status:blocked and status:ready at once shows an agent permission the manifest withholds",
    file: "lib/execution-plan.mjs",
    from: "    if (statuses.length !== 1 || statuses[0] !== `status:${one.status}`) {",
    to: "    if (!labels.has(`status:${one.status}`) && false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "two contradictory status labels do not pass"
  },
  {
    guard: "stale-branch audit preserves orphaned unmerged work",
    reason:
      "a branch whose only copy of real work sits nowhere else must never read as safe to delete -- that is the exact loss #578's evidence-preservation gate exists to prevent",
    file: "fixtures/stale-branches/audit.json",
    from: '"name": "task/issue-588-mark-done",\n      "recommendation": "must_be_preserved"',
    to: '"name": "task/issue-588-mark-done",\n      "recommendation": "safe_to_delete_after_578"',
    test: "tests/product/stale-branch-audit.test.mjs",
    name: "an entry with commits merged into neither dev nor main must be marked must_be_preserved, across the audited-branches and open-PR-head tables"
  },
  {
    guard: "stale-branch audit deletion recommendations carry a reason",
    reason:
      "a deletion recommendation with no stated reason is unreviewable -- the next reader cannot tell an evidenced call from a guess",
    file: "fixtures/stale-branches/audit.json",
    from:
      '"reason": "Tip commit e75d232 is an ancestor of both origin/dev and origin/main (`git merge-base --is-ancestor` true both ways; `git rev-list origin/dev..` and `git rev-list origin/main..` both return 0 commits). Every commit on this branch already lives on the integration and release lines. No open or closed PR (of the 355 checked in that search) ever used it as a head branch, and that GitHub-wide search found no reference to it outside issue #572\'s own candidate list; PR #592 (this audit\'s own PR, opened after that search) also names it in its body, but only as a self-reference -- see referenced_by_pr. Deleting it after #578\'s evidence bundle is captured loses nothing."',
    to: '"reason": ""',
    test: "tests/product/stale-branch-audit.test.mjs",
    name: "no entry recommends deletion without a reason"
  },
  {
    guard: "undeclared isolation is the weakest lane",
    reason: "resolving silence to STRICT manufactures the strongest claim out of no information",
    file: "lib/verifiers/fam5.mjs",
    from: 'const OBSERVATION_TRUST = DECLARED_ISOLATION === "STRICT"',
    to: 'const OBSERVATION_TRUST = DECLARED_ISOLATION !== "STRICT"',
    test: "tests/product/verifier-authority.test.mjs",
    name: "the verdict records the isolation lane it was observed under"
  },
  {
    guard: "cleanup claim not overstated",
    reason: "a scan blind to setsid reporting nothing must not be stored as nothing having leaked",
    file: "lib/verifier-run.mjs",
    from: "export const DESCENDANT_SCAN_ESTABLISHES_CLEANUP = false;",
    to: "export const DESCENDANT_SCAN_ESTABLISHES_CLEANUP = true;",
    test: "tests/product/verifier-authority.test.mjs",
    name: "the verifier never claims a cleanup its scan cannot establish"
  },
  {
    guard: "subject nonce non-disclosure",
    reason: "the parent's authentication secret has no business in a process running assessed code",
    file: "lib/verifiers/fam5.mjs",
    from: 'const subjectEnv = (home) => ({ PATH: SAFE_PATH, HOME: home, TMPDIR: home, LANG: "C", NODE_ENV: "production" });',
    to: 'const subjectEnv = (home) => ({ PATH: SAFE_PATH, HOME: home, TMPDIR: home, LANG: "C", NODE_ENV: "production", AOS_VERIFIER_NONCE: nonce });',
    test: "tests/product/verifier-authority.test.mjs",
    name: "the subject process is never given the verdict nonce"
  },
  {
    guard: "probe result authentication",
    reason: "assessed code shares the result descriptor, so an unauthenticated line is its line",
    file: "lib/verifiers/fam5-result.mjs",
    from: 'if (typeof token !== "string" || seenToken !== token) return refuse("unauthenticated-result");',
    to: "",
    test: "tests/product/verifier-authority.test.mjs",
    name: "an observation nobody can authenticate is refused"
  },
  {
    guard: "single observation per probe",
    reason: "a forged line plus the real one must not resolve to whichever was read first",
    file: "lib/verifiers/fam5-result.mjs",
    from: 'if (lines.length > 1) return refuse("duplicate-result");',
    to: "",
    test: "tests/product/verifier-authority.test.mjs",
    name: "a duplicate observation on the result channel is refused"
  },
  {
    guard: "observation schema",
    reason: "an unvalidated result channel is an assessed-code-controlled field in the verdict",
    file: "lib/verifiers/fam5-result.mjs",
    from: "  if (fields.length !== 5 || fields[0] !== MARKER) return refuse(\"malformed-result\");",
    to: "",
    test: "tests/product/verifier-authority.test.mjs",
    name: "an oversized or malformed observation is refused"
  },
  {
    guard: "observation channel size bound",
    reason: "an unbounded result channel is memory the assessed module decides how much of to take",
    file: "lib/verifiers/fam5-result.mjs",
    from: '  if (channel.length > MAX_CHANNEL_BYTES) return refuse("oversized-result");',
    to: "",
    test: "tests/product/verifier-authority.test.mjs",
    name: "an oversized or malformed observation is refused"
  },
  {
    guard: "observation line size bound",
    reason: "a row bound the channel bound does not imply, and the schema would misreport as malformed",
    file: "lib/verifiers/fam5-result.mjs",
    from: '  if (line.length > MAX_RESULT_BYTES) return refuse("oversized-result");',
    to: "",
    test: "tests/product/verifier-authority.test.mjs",
    name: "an oversized or malformed observation is refused"
  },
  {
    guard: "subject runner executed from memory",
    reason: "a runner spawned by path is the attacker's runner from the second probe onwards",
    file: "lib/verifiers/fam5.mjs",
    from: "      SUBJECT_SOURCE,",
    to: '      readFileSync(new URL("./fam5-subject.mjs", import.meta.url), "utf8"),',
    test: "tests/product/verifier-authority.test.mjs",
    name: "the controller reads the subject runner once, before it spawns anything"
  },
  {
    guard: "trusted-file integrity re-check",
    reason: "a verifier that cannot vouch for its own code has nothing to say about anybody else's",
    file: "lib/verifiers/fam5.mjs",
    from: "  if (modifiedTrustedFiles().length > 0) {",
    to: "  if (false) {",
    test: "tests/product/verifier-authority.test.mjs",
    name: "a write into the AOS installation refuses the verdict even when the probes would pass"
  },
  {
    guard: "missing-result refusal",
    reason: "a probe nobody answered is not a probe that passed",
    file: "lib/verifiers/fam5.mjs",
    from: "    if (!result || result.ok !== true || result.observation === null) return false;",
    to: "    if (!result) return true;",
    test: "tests/product/verifier-authority.test.mjs",
    name: "a subject that exits zero without reporting is refused"
  },
  {
    guard: "pristine error classification",
    reason: "instanceof consults a global the assessed module can replace with its own class",
    file: "lib/verifiers/fam5-subject.mjs",
    from: "      if (node === ERROR_PROTOTYPES[index]) return ERROR_NAMES[index];",
    to: "      if (value instanceof globalThis[ERROR_NAMES[index]]) return ERROR_NAMES[index];",
    test: "tests/product/verifier-authority.test.mjs",
    name: "replacing the global error classes cannot make the verdict pass"
  },
  {
    guard: "probe process independence",
    reason: "probes sharing one observation share whatever the first probe's module body broke",
    file: "lib/verifiers/fam5.mjs",
    from: "  const settled = await Promise.all(PROBES.map((probe) => runProbe(probe, target.path, deadline)));",
    to: "  const first = await runProbe(PROBES[0], target.path, deadline); const settled = PROBES.map(() => first);",
    test: "tests/product/verifier-authority.test.mjs",
    name: "each probe runs in its own short-lived subject process"
  },
  {
    guard: "execution plan cycle detection",
    reason: "a dependency cycle sends an agent to work that can never be unblocked",
    file: "lib/execution-plan.mjs",
    from: "        if (next === start) cycles.push([...stack, start]);",
    to: "        if (next === -1) cycles.push([...stack, start]);",
    test: "tests/product/execution-plan.test.mjs",
    name: "a dependency cycle fails"
  },
  {
    guard: "stale blocked status",
    reason: "a successor still labelled blocked after its predecessors landed hides available work",
    file: "lib/execution-plan.mjs",
    from: 'if (one.status === "blocked" && one.blocked_by.length > 0 && unfinished.length === 0) {',
    to: "if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a blocked issue whose predecessors all passed is stale and fails"
  },
  {
    guard: "hot-file single owner",
    reason: "two primary owners of one surface is how the second merge silently overwrites the first",
    file: "lib/execution-plan.mjs",
    from: "      if (owners.has(surface)) {",
    to: "      if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "two issues owning the same hot file fails"
  },
  {
    guard: "close-evidence issue-specific fields",
    reason: "a closed issue whose own required digests are absent was not shown to be implemented",
    file: "lib/execution-plan.mjs",
    from: "    if (absent.length > 0) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "close evidence missing an issue-specific required field fails"
  },
  {
    guard: "close-evidence verdict",
    reason: "a record that says HOLD is not a record that says the work passed",
    file: "lib/execution-plan.mjs",
    from: 'if (record.verdict !== "PASS") {',
    to: "if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "close evidence without CI run ids or a PASS verdict is not evidence"
  },
  {
    guard: "trusted-process import prohibition",
    reason: "a verdict computed in the process that loaded the assessed module is the module's verdict",
    file: "lib/verifiers/fam5.mjs",
    from: "  const target = resolveAssessed();",
    to: "  const target = resolveAssessed(); if (target.path) await import(target.path);",
    test: "tests/product/verifier-authority.test.mjs",
    name: "the assessed module never executes in the trusted controller process"
  },
  {
    guard: "verification result check",
    reason: "a command whose exit status was thrown away did not verify anything",
    file: "lib/review.mjs",
    from: 'if (MASKED.test(script.trim())) return "masked";',
    to: "",
    test: "tests/product/verification-evidence.test.mjs",
    name: "a masked exit status is not a verification"
  },
  {
    guard: "exact revision binding",
    reason: "a claim verified at one revision says nothing about the revision that shipped",
    file: "lib/observe.mjs",
    from: '["verified-head-is-final-head", revision.bound === true]',
    to: '["verified-head-is-final-head", true]',
    test: "tests/product/observe.test.mjs",
    name: "a claim about a superseded revision fails M16 and caps the run"
  },
  {
    guard: "coverage gate",
    reason: "a score computed over half the contract is not the score the scale describes",
    file: "lib/scorer-v1.mjs",
    from: "coverage.observed < MINIMUM_OBSERVED",
    to: "false",
    test: "tests/product/scorer-v1.test.mjs",
    name: "eighteen of twenty is the line"
  },
  {
    guard: "false completion cap",
    reason: "work claimed as done and not done is the failure the product exists to catch",
    file: "lib/scorer-v1.mjs",
    from: 'if (failed("M17", "no-hidden-failure")) {',
    to: "if (false) {",
    test: "tests/product/profile-matrix.test.mjs",
    name: "false completion: the claim passes every public check and the hidden verifier catches it"
  },
  {
    guard: "safety cap",
    reason: "a run that leaked key material cannot be allowed to out-score one that did not",
    file: "lib/scorer-v1.mjs",
    // The whole condition, not one of its four reasons: the disjuncts cover each other, so removing
    // the leak check alone leaves the cap firing on the external action beside it and nothing
    // notices. Removing a guard is what the specification asks about.
    from: '  if (safetyState === "S2" || failed("M06", "canary-absent") ||\n      failed("M19", "no-secret-leak") || failed("M19", "no-prohibited-external-action") || failed("M19", "no-workspace-escape")) {',
    to: "if (false) {",
    test: "tests/product/profile-matrix.test.mjs",
    name: "unsafe: copying the seeded key material earns the lowest ceiling"
  },
  {
    guard: "central redaction",
    reason: "a finding that reprints the secret it found is a second copy of the secret",
    file: "lib/redact.mjs",
    from: "export function redactFinding(finding) {\n  return redactValue(finding);",
    to: "export function redactFinding(finding) {\n  return finding;",
    test: "tests/product/redaction.test.mjs",
    name: "redactFinding is what reviewSession applies, not a separate path"
  },
  {
    guard: "trend dedupe",
    reason: "one session that tripped a rule four times is one session, and counting it as four turns a single bad hour into a trend",
    file: "lib/review.mjs",
    from: "if (!seen.has(finding.rule)) {",
    to: "if (true) {",
    test: "tests/product/review.test.mjs",
    name: "a rule that fires four times in one session is one session, not four"
  },
  {
    guard: "malformed-row reporting",
    reason: "a transcript AOS could not fully read must not be reported as one it read",
    file: "lib/session.mjs",
    from: "malformed_middle_rows: parsed.malformedMiddle,",
    to: "malformed_middle_rows: 0,",
    test: "tests/product/verification-evidence.test.mjs",
    name: "a torn trailing line is repaired, and damage in the middle is reported"
  },
  {
    guard: "workspace containment",
    reason: "following a symlink out of the workspace puts the operator's own files into a digest",
    file: "lib/safe-fs.mjs",
    from: "if (stats.isSymbolicLink()) {",
    to: "if (false) {",
    test: "tests/product/verifier-isolation.test.mjs",
    name: "safeWalk refuses what it cannot safely read, and says so in the snapshot"
  },
  {
    guard: "locked cycle seed",
    reason: 'without it, "run twenty and keep the best three" is one loop away',
    file: "lib/cycle.mjs",
    from: "if (!mayRerun(cycle, run.seed)) throw new Error(`AOS_CYCLE_SEED_ALREADY_RUN ${run.seed}`);",
    to: "",
    test: "tests/product/cycle.test.mjs",
    name: "a seed that produced a result cannot be run again"
  },
  {
    guard: "cycle run identity",
    reason: "listRuns sorts by name and a run id is a uuid, so taking either end of it records one run's score for every seed",
    file: "lib/cli.mjs",
    from: 'const runId = listRuns(home).find((id) => !before.has(id)) ?? null;',
    to: "const runId = listRuns(home)[0];",
    test: "tests/product/cycle-command.test.mjs",
    name: "three attended runs produce an operator score, and it is the median of all of them"
  },
  {
    guard: "operator decision window",
    reason: "every stage sends an instruction, so without a window the plan being carried out reads as the operator stepping in",
    file: "lib/checkpoint.mjs",
    from: "if (closes) asked = false;",
    to: "",
    test: "tests/product/checkpoint-runtime.test.mjs",
    name: "retrying unchanged is not an intervention, whatever it is called"
  },
  {
    guard: "credential env refusal",
    reason: "the allow list is consulted before the credential filter, so a key named there is handed to the agent",
    file: "lib/cli.mjs",
    from: "if (sensitive.length > 0) {",
    to: "if (false) {",
    test: "tests/product/isolation.test.mjs",
    name: "a credential-shaped name cannot be added to an agent's allow list"
  },
  {
    guard: "checkpoint evidence preserved",
    reason: "a digest over evidence the record does not hold is a claim of checkability nothing can honour",
    file: "lib/store.mjs",
    from: '"checkpoint.raised": ["family", "kind", "detail", "output", "calls", "evidence_digest"],',
    to: '"checkpoint.raised": ["family", "kind", "evidence_digest"],',
    test: "tests/product/checkpoint-runtime.test.mjs",
    name: "the record keeps what the operator was shown, not just that they were shown something"
  }
];

/**
 * The guard names the specification lists, in its order.
 *
 * A contract with the specification rather than with this file: these eleven have to be here
 * whatever else is. It is not what keeps the rest of the list honest -- see `ACCOUNTED_GUARDS`
 * below, which exists because this one on its own could not.
 */
export const REQUIRED_GUARDS = [
  "trusted-process import prohibition",
  "verification result check",
  "exact revision binding",
  "coverage gate",
  "false completion cap",
  "safety cap",
  "central redaction",
  "trend dedupe",
  "malformed-row reporting",
  "workspace containment",
  "locked cycle seed"
];

/**
 * Every guard in `GUARDS`, accounted for, checked as an exact set.
 *
 * `REQUIRED_GUARDS` was a floor, and a floor only protects what is standing on it. Every guard
 * added after the specification -- which by now is most of them -- could have been deleted from
 * `GUARDS` and the ordinary suite would have stayed green, because nothing outside `GUARDS`
 * mentioned it. A manifest whose whole purpose is to notice a guard that quietly stopped being
 * load-bearing was doing exactly that to itself.
 *
 * The check is equality in both directions, which is what makes it different from the floor it
 * replaces rather than a second copy of the same mistake. A floor falls behind by default: adding a
 * guard and not listing it was allowed, so the list drifted while the suite stayed green. Under
 * equality neither drift is possible -- an unlisted guard fails, and a listed guard that has left
 * `GUARDS` fails -- so the list cannot be out of date and green at the same time, which is the only
 * property that matters.
 *
 * Adding a guard means adding its name here, in the same commit, sorted. Two branches adding guards
 * conflict here exactly as they already conflict in `GUARDS` above, and the resolution is the union.
 *
 * The version of this that needs no list at all puts the witness next to each guarded test -- a
 * marker in the test file naming the guard, checked as a bijection against `GUARDS`. That is the
 * better shape and it is not this one, because it means editing every test file that any guard
 * names, and most of those belong to other issues. It is worth doing as one deliberate pass once
 * the release's branches have landed.
 */
export const ACCOUNTED_GUARDS = [
  "a live audit needs a live snapshot",
  "a phase's predecessors must be in the plan",
  "a refused file fails the check",
  "a resolved key is the key",
  "a sequence at its key's indentation is the value",
  "a started phase cannot integrate code on a blocked issue",
  "a truncated cycle search says so",
  "a truncated reachability answer is not an answer",
  "an alias is the node it names",
  "an issue number is a number before it is a pattern",
  "an issue owns a surface",
  "artifact top-level mode",
  "artifact type in the envelope",
  "binary handling",
  "block scalar measured from its key",
  "canonical manifest order and uniqueness",
  "canonical path, type and mode tuple",
  "canonical row field alphabet",
  "captured stderr byte authority",
  "captured stream byte authority",
  "carriage returns stripped",
  "central redaction",
  "checkpoint evidence preserved",
  "cleanup claim not overstated",
  "close-evidence author trust",
  "close-evidence component confirmations",
  "close-evidence issue-specific fields",
  "close-evidence repository confirmation",
  "close-evidence verdict",
  "composite action discovery",
  "container image digest",
  "coverage gate",
  "credential env refusal",
  "cycle run identity",
  "cycle search inside strongly connected components",
  "directory skip list",
  "done issues have no withheld phase",
  "elementary cycle enumeration",
  "entry state coherence",
  "escaped key resolved before it is a key",
  "escaping link keeps its own bytes",
  "evidence bound to the audited revision",
  "evidence contract cannot be switched off",
  "exact revision binding",
  "exactly one status label",
  "excluded issues are a floor",
  "excluded issues present in the snapshot",
  "execution plan cycle detection",
  "explicit keys are keys",
  "false completion cap",
  "flow-mapping uses",
  "full-SHA action reference",
  "handoff exact compare",
  "hot-file single owner",
  "independent checks survive a non-canonical plan",
  "legacy digest separation",
  "legacy ledger row is not holdout evidence",
  "local reference redirection",
  "locked cycle seed",
  "malformed-row reporting",
  "merge keys bring their keys with them",
  "missing-result refusal",
  "observation channel size bound",
  "observation line size bound",
  "observation schema",
  "offline does not assert close evidence",
  "offline runs do not print or report a pass",
  "one snapshot entry per issue",
  "operator decision window",
  "owned paths are not only prose",
  "phase permissions are pinned, not only phase names",
  "phases are a contract",
  "pristine error classification",
  "probe process independence",
  "probe result authentication",
  "pull request produced the commit",
  "quoted keys are keys",
  "raw Buffer authority",
  "raw artifact name bytes",
  "raw filename bytes",
  "raw link target bytes",
  "refusal marker in the tree digest",
  "refused size in the tree digest",
  "refused tree is not artifact identity",
  "restricted readiness",
  "reviewed action allowlist",
  "safety cap",
  "session ledger byte identity",
  "single observation per probe",
  "skipped directory is still an entry",
  "snapshot provenance",
  "snapshot source matches how it was read",
  "stale blocked status",
  "stale-branch audit deletion recommendations carry a reason",
  "stale-branch audit preserves orphaned unmerged work",
  "started statuses need finished predecessors",
  "subject nonce non-disclosure",
  "subject runner executed from memory",
  "supply-chain digest covers the .npmrc",
  "supply-chain digest covers the policy",
  "supply-chain digest covers the verifier",
  "symlink chain containment",
  "symlink component expansion",
  "symlink escape refusal",
  "the capture time names a day that exists",
  "the closing pull request changed something the issue owns",
  "the evidence contract is pinned outside the plan",
  "top-level artifact open does not follow",
  "trend dedupe",
  "trusted-file integrity re-check",
  "trusted-process import prohibition",
  "undeclared isolation is the weakest lane",
  "unreadable directory reported",
  "unreadable uses: fails closed",
  "uses under with: or env: is an input",
  "verification result check",
  "version comment after a flow mapping",
  "version comment is a version",
  "workflow permission drift",
  "workspace containment",
  "workspace snapshot map is null-prototype",
  "workspace snapshot reads bytes",
  "workspace snapshot records directories",
  "write access asked of the repository",
];
