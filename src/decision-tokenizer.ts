import type { SourceLocation } from "./decision-model.js";

type LocatedToken = {
  location: SourceLocation;
};

export type DecisionToken =
  | (LocatedToken & {
      id: string;
      title: string;
      type: "Decision";
    })
  | (LocatedToken & {
      id: string;
      kind: string;
      type: "Driver";
    })
  | (LocatedToken & {
      text: string;
      type: "Choice" | "Rationale" | "Acceptance";
    })
  | (LocatedToken & {
      id: string;
      type: "Supersession";
    });

export function tokenizeDecision(source: string): DecisionToken[] {
  const tokens: DecisionToken[] = [];

  for (const [index, sourceLine] of source.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (line === "") {
      continue;
    }

    const location = {
      column: sourceLine.search(/\S/) + 1,
      line: index + 1,
    };
    tokens.push(tokenizeStatement({ line, location }));
  }

  return tokens;
}

function tokenizeStatement({
  line,
  location,
}: {
  line: string;
  location: SourceLocation;
}): DecisionToken {
  const identity = line.match(/^Decision\s+(\S+)\s+"([^"]+)"$/);
  if (identity) {
    return {
      id: identity[1],
      location,
      title: identity[2],
      type: "Decision",
    };
  }

  const driver = line.match(/^Driven by\s+(\S+)\s+(\S+)$/);
  if (driver) {
    return {
      id: driver[2],
      kind: driver[1] === "requirement" ? "premise" : driver[1],
      location,
      type: "Driver",
    };
  }

  const choice = statementText(line, "Choose");
  if (choice) {
    return { location, text: choice, type: "Choice" };
  }

  const rationale = statementText(line, "Because");
  if (rationale) {
    return { location, text: rationale, type: "Rationale" };
  }

  const acceptance = statementText(line, "Accept");
  if (acceptance) {
    return { location, text: acceptance, type: "Acceptance" };
  }

  const supersession = line.match(/^Supersedes\s+(\S+)$/);
  if (supersession) {
    return {
      id: supersession[1],
      location,
      type: "Supersession",
    };
  }

  throw new Error(
    `Unknown statement at line ${location.line}, column ${location.column}`,
  );
}

function statementText(line: string, keyword: string): string | undefined {
  return line.match(new RegExp(`^${keyword}\\s+(.+)$`))?.[1];
}
