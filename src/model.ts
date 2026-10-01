export type CucumberConfiguration = {
  features?: string[];
  steps?: string[];
};

export type PremiseConfiguration = {
  cucumber?: CucumberConfiguration;
  jev?: { questions: string };
  version: 1;
};
