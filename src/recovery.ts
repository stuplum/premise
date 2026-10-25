import { checkText } from "./check-text.js";
import { fingerprintOf } from "./fingerprint.js";
import { commitAdding } from "./git.js";
import type { Config } from "./model.js";
import type { Reports } from "./reports/model.js";
import { sourcesAtCommit } from "./sources.js";
import { errorMessage } from "./text.js";

export type Recovery = { status: "recovered"; commit: string; text: string } | { status: "unrecoverable"; reason: string };

export async function recoverSignedText({
  projectDirectory,
  config,
  reports,
  decisionUri,
  check,
  fingerprint,
  ref,
}: {
  projectDirectory: string;
  config: Config;
  reports: Reports;
  decisionUri: string;
  check: string;
  fingerprint: string;
  ref: string;
}): Promise<Recovery> {
  const commit = await commitAdding({ projectDirectory, ref, uri: decisionUri, text: fingerprint });
  if (commit === undefined) {
    return { status: "unrecoverable", reason: `no commit reachable from ${ref} adds this fingerprint to ${decisionUri}` };
  }
  const short = commit.slice(0, 7);
  let text: string | undefined;
  try {
    text = await checkText({ id: check, sources: await sourcesAtCommit({ projectDirectory, config, reports, commit }) });
  } catch (error) {
    return { status: "unrecoverable", reason: `sources at ${short} could not be read: ${errorMessage(error)}` };
  }
  if (text === undefined) {
    return { status: "unrecoverable", reason: `no source for ${check} at ${short}` };
  }
  if (fingerprintOf(text) !== fingerprint) {
    return { status: "unrecoverable", reason: `text rebuilt at ${short} does not match the fingerprint` };
  }
  return { status: "recovered", commit, text };
}
