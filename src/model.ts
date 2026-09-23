export type CucumberConfiguration = {
  features?: string[];
  steps?: string[];
};

export type PremiseConfiguration = {
  cucumber?: CucumberConfiguration;
  version: 1;
};

export type ChangedRequirement = {
  affects: string[];
  id: string;
};
