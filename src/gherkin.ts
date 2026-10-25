import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateMessages } from "@cucumber/gherkin";
import { IdGenerator, SourceMediaType, type Pickle, type PickleStepArgument } from "@cucumber/messages";
import { glob } from "glob";
import { minimatch } from "minimatch";
import { ConfigurationError } from "./errors.js";
import type { Config } from "./model.js";
import { stableJson } from "./stable-json.js";
import { compareText } from "./text.js";

export type GherkinFile = { uri: string; pickles: Pickle[] };

const IGNORED_GHERKIN = "**/node_modules/**";

export async function loadGherkinFiles({
  projectDirectory,
  config,
}: {
  projectDirectory: string;
  config: Config;
}): Promise<GherkinFile[]> {
  if (config.gherkin === undefined) {
    return [];
  }
  const uris = await glob(config.gherkin, { cwd: projectDirectory, nodir: true, posix: true, ignore: [IGNORED_GHERKIN] });
  const pattern = config.gherkin;
  const files: GherkinFile[] = [];
  for (const uri of uris.filter((candidate) => selectsGherkinFile({ uri: candidate, pattern })).sort(compareText)) {
    files.push({ uri, pickles: parsePickles({ content: await readFile(join(projectDirectory, uri), "utf8"), uri }) });
  }
  return files;
}

export function selectsGherkinFile({ uri, pattern }: { uri: string; pattern: string }): boolean {
  return minimatch(uri, pattern) && !minimatch(uri, IGNORED_GHERKIN);
}

export function parsePickles({ content, uri }: { content: string; uri: string }): Pickle[] {
  const envelopes = generateMessages(content, uri, SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN, {
    includeGherkinDocument: false,
    includePickles: true,
    includeSource: false,
    newId: IdGenerator.incrementing(),
  });
  const errors = envelopes.flatMap((envelope) => (envelope.parseError ? [envelope.parseError.message] : []));
  if (errors.length > 0) {
    throw new ConfigurationError(errors.map((message) => `${uri}: invalid Gherkin: ${message}`).join("\n"));
  }
  return envelopes.flatMap((envelope) => (envelope.pickle ? [envelope.pickle] : []));
}

export function gherkinText({ id, files }: { id: string; files: GherkinFile[] }): string | undefined {
  const tag = `@${id}`;
  const lines = files.flatMap((file) =>
    file.pickles
      .filter((pickle) => pickle.tags.some((pickleTag) => pickleTag.name === tag))
      .flatMap((pickle) => pickleLines({ pickle, uri: file.uri })),
  );
  return lines.length > 0 ? `${lines.join("\n")}\n` : undefined;
}

function pickleLines({ pickle, uri }: { pickle: Pickle; uri: string }): string[] {
  return [`pickle ${uri}`, ...pickle.steps.map((step) => stableJson({ type: step.type ?? "Unknown", text: step.text, ...argumentFields(step.argument) }))];
}

function argumentFields(argument: PickleStepArgument | undefined): Record<string, unknown> {
  if (argument?.docString) {
    return { docString: argument.docString.content, mediaType: argument.docString.mediaType };
  }
  if (argument?.dataTable) {
    return { rows: argument.dataTable.rows.map((row) => row.cells.map((cell) => cell.value)) };
  }
  return {};
}
