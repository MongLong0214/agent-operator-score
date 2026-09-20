// The wire format a subject process uses to report one probe, and the controller's reader for it.
//
// Two properties matter, and both come from the format being this small.
//
// The first is that the subject reports an observation, never a verdict. There is no field here a
// module can set to "pass". `returned 3` and `threw RangeError` are statements about what happened
// when a function was called; whether they amount to a passing FAM-5 is decided elsewhere, against
// an expectation the subject never gets to write.
//
// The second is that a result is bound to the spawn that asked for it. The assessed module runs in
// the subject process and can therefore write to the result fd -- it is an inherited descriptor,
// not a capability. What it cannot write is the token, which the controller generates per probe,
// delivers on stdin and never puts in the environment or the argument vector. So an observation the
// module writes fails to authenticate, and if it writes one and lets the subject write the real one
// too, the channel carries two lines and the whole probe is refused. There is no shape of channel
// traffic that reads as "one authenticated pass" unless the subject produced it.

/** Not stdout. The subject's stdout is discarded, so nothing it prints can reach the parent. */
export const RESULT_FD = 3;
export const MAX_RESULT_BYTES = 512;
export const MAX_CHANNEL_BYTES = 4096;

const MARKER = "AOS_OBS";
const TOKEN = /^[0-9a-f-]{36}$/;
const PROBE_ID = /^[a-z0-9-]{1,32}$/;
const DETAIL = /^[A-Za-z0-9_.+-]{1,64}$/;

// What a subject is allowed to have seen. `returned` and `threw` are the two ordinary outcomes;
// the rest say the probe never got as far as an outcome, and the controller reads all four the same
// way -- not the expected observation, so not a pass.
const KINDS = new Set(["returned", "returned-other", "threw", "no-export", "import-failed", "internal"]);

/** Built with string concatenation only: no serialiser the assessed module could have replaced. */
export const formatObservation = (token, probeId, kind, detail) =>
  MARKER + " " + token + " " + probeId + " " + kind + " " + detail + "\n";

/**
 * Reads the one observation a subject was asked for, or says why there is none.
 *
 * Silence, two answers, an answer for another probe and an answer nobody can authenticate are all
 * refusals with their own reason, because they are different failures and the evidence should say
 * which one happened. None of them is a pass.
 */
export function parseObservation(channel, { token, probeId } = {}) {
  const refuse = (reason) => ({ ok: false, reason, observation: null });
  if (typeof channel !== "string" || channel.length === 0) return refuse("no-result");
  if (channel.length > MAX_CHANNEL_BYTES) return refuse("oversized-result");
  const lines = channel.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return refuse("no-result");
  if (lines.length > 1) return refuse("duplicate-result");
  const line = lines[0];
  if (line.length > MAX_RESULT_BYTES) return refuse("oversized-result");

  const fields = line.split(" ");
  if (fields.length !== 5 || fields[0] !== MARKER) return refuse("malformed-result");
  const [, seenToken, seenProbe, kind, detail] = fields;
  // Shape before identity: a token that is not token-shaped is a protocol violation and saying
  // "unauthenticated" about it would suggest the sender at least spoke the protocol.
  if (!TOKEN.test(seenToken)) return refuse("malformed-result");
  if (!PROBE_ID.test(seenProbe)) return refuse("malformed-result");
  if (!DETAIL.test(detail)) return refuse("malformed-result");
  if (typeof token !== "string" || seenToken !== token) return refuse("unauthenticated-result");
  if (typeof probeId !== "string" || seenProbe !== probeId) return refuse("wrong-probe");
  if (!KINDS.has(kind)) return refuse("unknown-kind");
  return { ok: true, reason: null, observation: { probe_id: seenProbe, kind, detail } };
}
