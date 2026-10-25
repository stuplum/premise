import { readFileSync } from "node:fs";
import { Ajv, type ValidateFunction } from "ajv";
import { parse } from "yaml";
import { ConfigurationError } from "./errors.js";
import { errorMessage } from "./text.js";

type SchemaName = "config" | "decision";

const ajv = new Ajv({ allErrors: true });
const validators = new Map<SchemaName, ValidateFunction>();

export function parseYaml({ content, uri }: { content: string; uri: string }): unknown {
  try {
    return parse(content);
  } catch (error) {
    throw new ConfigurationError(`${uri}: invalid YAML: ${errorMessage(error)}`);
  }
}

export function validateAgainst({
  schema,
  value,
  uri,
}: {
  schema: SchemaName;
  value: unknown;
  uri: string;
}): void {
  const validate = validatorFor(schema);
  if (validate(value)) {
    return;
  }
  const messages = (validate.errors ?? []).map(
    (error) => `${uri}: ${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
  throw new ConfigurationError([...new Set(messages)].join("\n"));
}

function validatorFor(schema: SchemaName): ValidateFunction {
  const existing = validators.get(schema);
  if (existing) {
    return existing;
  }
  const document = JSON.parse(
    readFileSync(new URL(`../schema/${schema}.schema.json`, import.meta.url), "utf8"),
  );
  const validate = ajv.compile(document);
  validators.set(schema, validate);
  return validate;
}
