export type SignoffMode = "human" | "none" | `classifier:${string}`;

export type ReportFormat = "junit" | "cucumber-json" | "dependency-cruiser";

export type Thresholds = { established: number; failed: number };

export type JevClassifier = { adapter: "jev"; model: string; thresholds: Thresholds };

export type CommandClassifier = {
  adapter: "command";
  command: string[];
  model: string;
  thresholds: Thresholds;
};

export type ClassifierConfig = JevClassifier | CommandClassifier;

export type Config = {
  decisions: string;
  reports: { format: ReportFormat; path: string }[];
  gherkin?: string;
  dependencyCruiserConfig?: string;
  signoff: { default: SignoffMode; allowed: SignoffMode[] };
  classifiers: Record<string, ClassifierConfig>;
};

export type DecisionStatus = "proposed" | "accepted" | "superseded";

export type DecisionOption = { name: string; pros: string[]; cons: string[] };

export type CheckLink = { check: string; fingerprint?: string };

export type Decision = {
  id: string;
  title: string;
  status: DecisionStatus;
  date: string;
  context: string;
  options: DecisionOption[];
  decision: string;
  because: string[];
  consequences: string[];
  scope: string[];
  supportedBy: CheckLink[];
  enforcedBy: CheckLink[];
  signoff: SignoffMode;
  supersedes?: string;
  uri: string;
};
