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
  prepare(context: EvaluationContext): Promise<PremiseProviderSession>;
}

export interface PremiseProviderSession {
  discover(): Promise<readonly Premise[]>;
  evaluate(premise: Premise): Promise<EvaluationResult>;
}

export type PremiseEvaluation = {
  premise: Premise;
  provider: string;
  result: EvaluationResult;
};

export type DiscoveredPremise = {
  premise: Premise;
  provider: PremiseProvider;
};

type PreparedPremise = DiscoveredPremise & {
  session: PremiseProviderSession;
};

export async function discoverPremises({
  projectDirectory,
  providers,
}: {
  projectDirectory: string;
  providers: readonly PremiseProvider[];
}): Promise<DiscoveredPremise[]> {
  return (await preparePremises({ projectDirectory, providers })).map(
    ({ premise, provider }) => ({ premise, provider }),
  );
}

async function preparePremises({
  projectDirectory,
  providers,
}: {
  projectDirectory: string;
  providers: readonly PremiseProvider[];
}): Promise<PreparedPremise[]> {
  requireUniqueProviders(providers);
  const discoveries: PreparedPremise[] = [];
  const premiseProviders = new Map<string, string>();

  for (const provider of providers) {
    const session = await provider.prepare({ projectDirectory });
    const premises = await session.discover();
    for (const premise of premises) {
      requireSupportedDialect({ premise, provider });
      requireUniquePremise({ premise, premiseProviders, provider });
      discoveries.push({ premise, provider, session });
    }
  }

  return discoveries;
}

export async function evaluatePremises({
  projectDirectory,
  providers,
}: {
  projectDirectory: string;
  providers: readonly PremiseProvider[];
}): Promise<PremiseEvaluation[]> {
  const discoveries = await preparePremises({ projectDirectory, providers });

  const evaluations: PremiseEvaluation[] = [];

  for (const { premise, provider, session } of discoveries) {
    evaluations.push({
      premise,
      provider: provider.id,
      result: await session.evaluate(premise),
    });
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
