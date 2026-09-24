export type CucumberConfiguration = {
  features?: string[];
  steps?: string[];
};

export type PremiseConfiguration = {
  cucumber?: CucumberConfiguration;
  version: 1;
};
