export type SourceLocation = {
  column: number;
  line: number;
};

export type LocatedText = {
  location: SourceLocation;
  text: string;
};

export type LocatedReference = {
  id: string;
  location: SourceLocation;
};

export type DecisionDriver = LocatedReference & {
  kind: string;
};

export type DecisionAst = {
  acceptedCosts: LocatedText[];
  choice: LocatedText;
  drivers: DecisionDriver[];
  id: string;
  location: SourceLocation;
  rationale: LocatedText;
  supersedes?: LocatedReference;
  title: string;
  type: "Decision";
};

export type ParsedDecision = DecisionAst;
