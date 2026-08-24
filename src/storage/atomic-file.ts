import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

/**
 * Durable writes for anything a later run reads back as fact.
 *
 * write temp -> fsync file -> rename -> fsync directory
 *
 * The directory fsync is the step that is usually missing. Without it the rename can still be lost
 * on power failure while the file contents survive, leaving a run directory whose final artifact is
 * absent even though every byte reached the disk — recovery then cannot distinguish that from a run
 * that never finished scoring.
 *
 * The temp name carries randomness so two processes racing on the same target cannot collide on a
 * partially written file; the rename decides the winner, and rename is atomic within a directory.
 */

export interface AtomicWriteOptions {
  /** Directory fsync is skipped only where the platform does not permit it; never for speed. */
  readonly syncDirectory?: boolean;
}

const fsyncDirectory = (directory: string): void => {
  let handle: number | undefined;
  try {
    handle = openSync(directory, "r");
    fsyncSync(handle);
  } catch {
    // Some filesystems refuse to open a directory for reading. The rename has already happened;
    // losing the directory fsync weakens durability but does not corrupt what was written, so this
    // is tolerated rather than turned into a failed write.
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
};

export const writeFileAtomic = (path: string, contents: string, options: AtomicWriteOptions = {}): void => {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${randomBytes(8).toString("hex")}.tmp`);
  let handle: number | undefined;
  try {
    handle = openSync(temporary, "wx", 0o600);
    writeSync(handle, contents, null, "utf8");
    fsyncSync(handle);
    closeSync(handle);
    handle = undefined;
    renameSync(temporary, path);
  } catch (error: unknown) {
    if (handle !== undefined) {
      try {
        closeSync(handle);
      } catch {
        // The write already failed; a close failure adds nothing the caller can act on.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // The temp file may never have been created. Leaving it would be worse than ignoring this.
    }
    throw error;
  }
  if (options.syncDirectory !== false) fsyncDirectory(directory);
};

/**
 * Appends one NDJSON record. The newline is written with the record in a single call so a crash
 * cannot leave a line without its terminator, which a reader would otherwise splice onto whatever
 * is appended next and parse as one malformed record.
 */
export const appendNdjsonLine = (path: string, line: string): void => {
  if (line.includes("\n")) {
    throw new Error("AOS_INTERNAL_ERROR an NDJSON record must not contain a newline");
  }
  mkdirSync(dirname(path), { recursive: true });
  const handle = openSync(path, "a", 0o600);
  try {
    writeSync(handle, `${line}\n`, null, "utf8");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
};
