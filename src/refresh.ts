import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { describeResult } from "./check-results.js";
import { ConfigurationError, RefusedError } from "./errors.js";
import { evaluateRepository, type LinkEvaluation } from "./evaluate.js";
import { fingerprintOf } from "./fingerprint.js";
import { compareText } from "./text.js";

export type RefreshResult = { uri: string; fingerprints: { check: string; fingerprint: string }[] };

export async function refreshDecision({
  projectDirectory,
  decisionId,
}: {
  projectDirectory: string;
  decisionId: string;
}): Promise<RefreshResult> {
  const { decisions, evaluations } = await evaluateRepository({ projectDirectory });
  const decision = decisions.find((candidate) => candidate.id === decisionId);
  if (!decision) {
    throw new ConfigurationError(`No decision ${decisionId}`);
  }
  const evaluation = evaluations.find((candidate) => candidate.decision.id === decisionId);
  if (!evaluation) {
    throw new RefusedError(`${decisionId} is ${decision.status}; only accepted decisions are refreshed`);
  }
  const blocked = evaluation.links.filter((link) => link.result.status !== "passed" || link.text === undefined);
  if (blocked.length > 0) {
    throw new RefusedError([`${decisionId} not refreshed:`, ...blocked.map(describeBlocked)].join("\n"));
  }
  const fingerprints = new Map(evaluation.links.map((link) => [link.check, fingerprintOf(link.text ?? "")]));
  await writeFingerprints({ projectDirectory, uri: decision.uri, fingerprints });
  return {
    uri: decision.uri,
    fingerprints: [...fingerprints]
      .sort(([left], [right]) => compareText(left, right))
      .map(([check, fingerprint]) => ({ check, fingerprint })),
  };
}

async function writeFingerprints({
  projectDirectory,
  uri,
  fingerprints,
}: {
  projectDirectory: string;
  uri: string;
  fingerprints: Map<string, string>;
}): Promise<void> {
  const path = join(projectDirectory, uri);
  const document = parseDocument(await readFile(path, "utf8"));
  for (const field of ["supported_by", "enforced_by"]) {
    const links = document.get(field);
    if (!isSeq(links)) {
      continue;
    }
    for (const item of links.items) {
      if (!isMap(item)) {
        continue;
      }
      const check = item.get("check");
      const fingerprint = typeof check === "string" ? fingerprints.get(check) : undefined;
      if (fingerprint !== undefined) {
        item.set("fingerprint", fingerprint);
      }
    }
  }
  await writeFile(path, document.toString({ lineWidth: 0 }));
}

function describeBlocked(link: LinkEvaluation): string {
  const unavailable = link.text === undefined ? ", check text unavailable" : "";
  return `  ${link.kind} ${link.check}: ${describeResult(link.result)}${unavailable}`;
}
