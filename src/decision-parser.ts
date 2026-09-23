import type {
  DecisionAst,
  DecisionDriver,
  LocatedReference,
  LocatedText,
} from "./decision-model.js";
import {
  tokenizeDecision,
  type DecisionToken,
} from "./decision-tokenizer.js";
import { validateDecision } from "./decision-validator.js";

type DecisionTokenType = DecisionToken["type"];
type TokenOfType<Type extends DecisionTokenType> = Extract<
  DecisionToken,
  { type: Type }
>;

const statementNames: Record<DecisionTokenType, string> = {
  Acceptance: "Accept",
  Choice: "Choose",
  Decision: "Decision",
  Driver: "Driven by",
  Rationale: "Because",
  Supersession: "Supersedes",
};

export function parseDecision(source: string): DecisionAst {
  const tokens = new DecisionTokenStream(tokenizeDecision(source));
  const identity = tokens.consume("Decision");
  const drivers = parseDrivers(tokens);
  const choice = toLocatedText(tokens.consume("Choice"));
  const rationale = toLocatedText(tokens.consume("Rationale"));
  const acceptedCosts = tokens
    .consumeWhile("Acceptance")
    .map(toLocatedText);
  const supersedes = parseSupersession(tokens);

  tokens.requireEnd();

  const decision: DecisionAst = {
    acceptedCosts,
    choice,
    drivers,
    id: identity.id,
    location: identity.location,
    rationale,
    supersedes,
    title: identity.title,
    type: "Decision",
  };
  validateDecision(decision);
  return decision;
}

class DecisionTokenStream {
  private index = 0;

  constructor(private readonly tokens: DecisionToken[]) {}

  consume<Type extends DecisionTokenType>(
    type: Type,
  ): TokenOfType<Type> {
    const token = this.current();
    if (token?.type !== type) {
      throw expectedStatement(type, token);
    }

    this.index += 1;
    return token as TokenOfType<Type>;
  }

  consumeWhile<Type extends DecisionTokenType>(
    type: Type,
  ): TokenOfType<Type>[] {
    const matches: TokenOfType<Type>[] = [];
    while (this.current()?.type === type) {
      matches.push(this.consume(type));
    }
    return matches;
  }

  is(type: DecisionTokenType): boolean {
    return this.current()?.type === type;
  }

  requireEnd(): void {
    const token = this.current();
    if (token) {
      throw new Error(
        `Expected end of document at line ${token.location.line}, found ${statementNames[token.type]}`,
      );
    }
  }

  private current(): DecisionToken | undefined {
    return this.tokens[this.index];
  }
}

function parseDrivers(tokens: DecisionTokenStream): DecisionDriver[] {
  const drivers = [toDriver(tokens.consume("Driver"))];
  while (tokens.is("Driver")) {
    drivers.push(toDriver(tokens.consume("Driver")));
  }
  return drivers;
}

function parseSupersession(
  tokens: DecisionTokenStream,
): LocatedReference | undefined {
  if (!tokens.is("Supersession")) {
    return undefined;
  }

  const token = tokens.consume("Supersession");
  return { id: token.id, location: token.location };
}

function toDriver(token: TokenOfType<"Driver">): DecisionDriver {
  return {
    id: token.id,
    kind: token.kind,
    location: token.location,
  };
}

function toLocatedText(
  token: TokenOfType<"Choice" | "Rationale" | "Acceptance">,
): LocatedText {
  return { location: token.location, text: token.text };
}

function expectedStatement(
  expectedType: DecisionTokenType,
  actual: DecisionToken | undefined,
): Error {
  const expected = statementNames[expectedType];
  if (!actual) {
    return new Error(`Expected ${expected} at end of document`);
  }

  return new Error(
    `Expected ${expected} at line ${actual.location.line}, found ${statementNames[actual.type]}`,
  );
}
