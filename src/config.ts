import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigurationError } from "./errors.js";
import type { ClassifierConfig, Config, SignoffMode } from "./model.js";
import { parseYaml, validateAgainst } from "./schema.js";

export const CONFIG_FILE = "premise.yaml";

type ConfigDocument = {
  decisions: string;
  reports: Config["reports"];
  gherkin?: string;
  dependency_cruiser_config?: string;
  signoff?: Config["signoff"];
  classifiers?: Record<string, ClassifierConfig>;
};

export async function loadConfig({ projectDirectory }: { projectDirectory: string }): Promise<Config> {
  const content = await readConfigFile({ projectDirectory });
  const document = parseYaml({ content, uri: CONFIG_FILE });
  validateAgainst({ schema: "config", value: document, uri: CONFIG_FILE });
  const config = withDefaults(document as ConfigDocument);
  requireConsistentConfig(config);
  return config;
}

export function classifierName(mode: SignoffMode): string | undefined {
  return mode.startsWith("classifier:") ? mode.slice("classifier:".length) : undefined;
}

async function readConfigFile({ projectDirectory }: { projectDirectory: string }): Promise<string> {
  try {
    return await readFile(join(projectDirectory, CONFIG_FILE), "utf8");
  } catch {
    throw new ConfigurationError(`${CONFIG_FILE}: cannot be read`);
  }
}

function withDefaults(document: ConfigDocument): Config {
  return {
    decisions: document.decisions,
    reports: document.reports,
    gherkin: document.gherkin,
    dependencyCruiserConfig: document.dependency_cruiser_config,
    signoff: document.signoff ?? { default: "human", allowed: ["human"] },
    classifiers: document.classifiers ?? {},
  };
}

function requireConsistentConfig(config: Config): void {
  const problems: string[] = [];
  if (!config.signoff.allowed.includes(config.signoff.default)) {
    problems.push(`signoff.default ${config.signoff.default} is not in signoff.allowed`);
  }
  for (const mode of config.signoff.allowed) {
    const name = classifierName(mode);
    if (name !== undefined && !Object.hasOwn(config.classifiers, name)) {
      problems.push(`signoff.allowed names ${mode} but classifiers.${name} is not configured`);
    }
  }
  for (const [name, classifier] of Object.entries(config.classifiers)) {
    if (classifier.thresholds.failed >= classifier.thresholds.established) {
      problems.push(`classifiers.${name}.thresholds.failed must be below established`);
    }
  }
  if (problems.length > 0) {
    throw new ConfigurationError(problems.map((problem) => `${CONFIG_FILE}: ${problem}`).join("\n"));
  }
}
