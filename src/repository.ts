import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CucumberConfiguration,
  PremiseConfiguration,
} from "./model.js";

const configurationFileName = "premise.json";

export async function readConfiguration({
  projectDirectory,
}: {
  projectDirectory: string;
}): Promise<PremiseConfiguration> {
  const path = join(projectDirectory, configurationFileName);
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return { version: 1 };
    }
    throw error;
  }

  try {
    const configuration: unknown = JSON.parse(content);
    if (!isPremiseConfiguration(configuration)) {
      throw new Error();
    }
    return configuration;
  } catch {
    throw new Error(`Invalid Premise configuration: ${configurationFileName}`);
  }
}

function isPremiseConfiguration(value: unknown): value is PremiseConfiguration {
  if (!isRecord(value) || value.version !== 1) {
    return false;
  }

  if (!hasOnlyKeys({ keys: ["version", "cucumber"], value })) {
    return false;
  }

  return value.cucumber === undefined || isCucumberConfiguration(value.cucumber);
}

function isCucumberConfiguration(value: unknown): value is CucumberConfiguration {
  if (!isRecord(value)) {
    return false;
  }

  if (!hasOnlyKeys({ keys: ["features", "steps"], value })) {
    return false;
  }

  return (
    isOptionalPathList(value.features) && isOptionalPathList(value.steps)
  );
}

function isOptionalPathList(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every((path) => typeof path === "string" && path.length > 0))
  );
}

function hasOnlyKeys({
  keys,
  value,
}: {
  keys: string[];
  value: Record<string, unknown>;
}) {
  const allowedKeys = new Set(keys);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
