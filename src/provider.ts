export type Premise = {
  assertion: PremiseAssertion;
  description: string;
  id: string;
  type: string;
};

export type PremiseAssertion = {
  dialect: string;
  ref: AssertionReference;
};

export type AssertionReference = {
  selector?: string;
  uri: string;
};

export type SourceRange = {
  end: SourcePosition;
  start: SourcePosition;
};

export type SourcePosition = {
  column: number;
  line: number;
};

export type Evidence = {
  range?: SourceRange;
  role?: string;
  uri: string;
};

export type Diagnostic = {
  message: string;
  range?: SourceRange;
  uri?: string;
};

export type EvaluationResult =
  | { evidence?: Evidence[]; status: "established" }
  | { diagnostics: Diagnostic[]; evidence?: Evidence[]; status: "failed" }
  | { reason: string; status: "unknown" };

export type EvaluationContext = {
  projectDirectory: string;
};

export interface PremiseProvider {
  readonly dialects: readonly string[];
  readonly id: string;
  discover(context: EvaluationContext): Promise<readonly Premise[]>;
  evaluate(
    premise: Premise,
    context: EvaluationContext,
  ): Promise<EvaluationResult>;
}

export type PremiseEvaluation = {
  premise: Premise;
  provider: string;
  result: EvaluationResult;
};

export async function evaluatePremises({
  projectDirectory,
  providers,
}: {
  projectDirectory: string;
  providers: readonly PremiseProvider[];
}): Promise<PremiseEvaluation[]> {
  requireUniqueProviders(providers);
  const discoveries = [];
  const premiseProviders = new Map<string, string>();

  for (const provider of providers) {
    const premises = await provider.discover({ projectDirectory });
    for (const premise of premises) {
      requireSupportedDialect({ premise, provider });
      requireUniquePremise({ premise, premiseProviders, provider });
    }
    discoveries.push({ premises, provider });
  }

  const evaluations: PremiseEvaluation[] = [];

  for (const { premises, provider } of discoveries) {
    for (const premise of premises) {
      evaluations.push({
        premise,
        provider: provider.id,
        result: await provider.evaluate(premise, { projectDirectory }),
      });
    }
  }

  return evaluations;
}

function requireUniqueProviders(providers: readonly PremiseProvider[]) {
  const ids = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.id)) {
      throw new Error(`Duplicate provider ${provider.id}`);
    }
    ids.add(provider.id);
  }
}

function requireSupportedDialect({
  premise,
  provider,
}: {
  premise: Premise;
  provider: PremiseProvider;
}) {
  if (!provider.dialects.includes(premise.assertion.dialect)) {
    throw new Error(
      `Provider ${provider.id} does not support dialect ${premise.assertion.dialect} for premise ${premise.id}`,
    );
  }
}

function requireUniquePremise({
  premise,
  premiseProviders,
  provider,
}: {
  premise: Premise;
  premiseProviders: Map<string, string>;
  provider: PremiseProvider;
}) {
  const existingProvider = premiseProviders.get(premise.id);
  if (existingProvider) {
    throw new Error(
      `Duplicate premise ${premise.id} from providers ${existingProvider} and ${provider.id}`,
    );
  }
  premiseProviders.set(premise.id, provider.id);
}
