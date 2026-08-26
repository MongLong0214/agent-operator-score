#!/usr/bin/env node
import { runCli } from "../lib/cli.mjs";

try {
  const code = await runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  });
  process.exitCode = code;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`AOS_INTERNAL_ERROR ${message}\n`);
  process.exitCode = 70;
}
