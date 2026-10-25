export type CaseOutcome = "passed" | "failed" | "skipped";

export type TestCase = {
  checks: string[];
  outcome: CaseOutcome;
  file?: string;
  source: string;
};

export type RuleDefinition = {
  name: string;
  severity?: unknown;
  from?: unknown;
  module?: unknown;
  to?: unknown;
};

export type RuleResult = {
  name: string;
  definition: RuleDefinition;
  violated: boolean;
  blindReason?: string;
  source: string;
};

export type Reports = { cases: TestCase[]; rules: RuleResult[] };
