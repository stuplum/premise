import type {
  ArtifactContextProjection,
  ContextEntry,
} from "./context-projection.js";

export function renderArtifactContext({
  knowledge,
}: ArtifactContextProjection): string {
  if (knowledge.length === 0) {
    return "";
  }
  return `${knowledge.map(renderEntry).join("\n\n")}\n`;
}

function renderEntry(entry: ContextEntry) {
  const classification =
    entry.kind === "premise"
      ? `${entry.premiseType} / ${entry.dialect} via ${entry.provider}`
      : "decision";
  return [
    entry.id,
    `  ${classification}`,
    `  ${entry.state.status}`,
    `  ${entry.description}`,
    ...renderStateDetails(entry.state).map((line) => `  ${line}`),
    `  source: ${renderSource(entry.source)}`,
  ].join("\n");
}

function renderStateDetails(state: ContextEntry["state"]): string[] {
  if (state.status === "reconsider") {
    return state.reasons.map(({ message }) => `Reason: ${message}`);
  }
  if (state.status === "failed") {
    return state.diagnostics.map(({ message, uri }) =>
      uri ? `Diagnostic: ${message} (${uri})` : `Diagnostic: ${message}`,
    );
  }
  if (state.status === "unknown") {
    return [`Reason: ${state.reason}`];
  }
  return [];
}

function renderSource({ selector, uri }: ContextEntry["source"]) {
  return selector ? `${uri}#${selector}` : uri;
}
