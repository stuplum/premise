import { mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { loadConfig } from "./config.js";
import { loadDecisions } from "./decisions.js";
import type { Decision, DecisionOption } from "./model.js";

export function renderDecision({
  decision,
  supersededBy,
}: {
  decision: Decision;
  supersededBy: string | undefined;
}): string {
  const sections = [
    [
      `# ${decision.id}: ${decision.title}`,
      "",
      `- Status: ${decision.status}`,
      `- Date: ${decision.date}`,
      `- Sign-off: ${decision.signoff}`,
      ...(decision.supersedes ? [`- Supersedes: ${link(decision.supersedes)}`] : []),
      ...(supersededBy ? [`- Superseded by: ${link(supersededBy)}`] : []),
    ],
    section({ heading: "Context", lines: [decision.context.trim()] }),
    section({ heading: "Options", lines: decision.options.flatMap(optionLines) }),
    section({ heading: "Decision", lines: [decision.decision] }),
    section({ heading: "Because", lines: bullets(decision.because) }),
    decision.consequences.length > 0 ? section({ heading: "Consequences", lines: bullets(decision.consequences) }) : [],
    decision.supportedBy.length + decision.enforcedBy.length > 0 ? section({ heading: "Checks", lines: checkLines(decision) }) : [],
    decision.scope.length > 0 ? section({ heading: "Scope", lines: decision.scope.map((pattern) => `- \`${pattern}\``) }) : [],
  ];
  return `${sections.filter((lines) => lines.length > 0).map((lines) => lines.join("\n")).join("\n\n")}\n`;
}

export async function renderDecisions({ projectDirectory, out }: { projectDirectory: string; out: string }): Promise<string[]> {
  const config = await loadConfig({ projectDirectory });
  const decisions = await loadDecisions({ projectDirectory, config });
  await mkdir(join(projectDirectory, out), { recursive: true });
  const written: string[] = [];
  for (const decision of decisions) {
    const supersededBy = decisions.find((candidate) => candidate.supersedes === decision.id)?.id;
    const uri = posix.join(out, `${decision.id}.md`);
    await writeFile(join(projectDirectory, uri), renderDecision({ decision, supersededBy }));
    written.push(uri);
  }
  return written;
}

function section({ heading, lines }: { heading: string; lines: string[] }): string[] {
  return [`## ${heading}`, "", ...lines];
}

function optionLines(option: DecisionOption, index: number): string[] {
  return [
    ...(index > 0 ? [""] : []),
    `### ${option.name}`,
    ...(option.pros.length + option.cons.length > 0 ? [""] : []),
    ...option.pros.map((pro) => `- Pro: ${pro}`),
    ...option.cons.map((con) => `- Con: ${con}`),
  ];
}

function checkLines(decision: Decision): string[] {
  return [
    ...(decision.supportedBy.length > 0 ? [`- Supported by: ${codeList(decision.supportedBy.map((link) => link.check))}`] : []),
    ...(decision.enforcedBy.length > 0 ? [`- Enforced by: ${codeList(decision.enforcedBy.map((link) => link.check))}`] : []),
  ];
}

function bullets(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function codeList(items: string[]): string {
  return items.map((item) => `\`${item}\``).join(", ");
}

function link(id: string): string {
  return `[${id}](${id}.md)`;
}
