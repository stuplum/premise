import assert from "node:assert/strict";
import { ConfigurationError, RefusedError } from "../../src/errors.js";

export async function assertConfigurationError({
  action,
  pattern,
}: {
  action: Promise<unknown>;
  pattern: RegExp;
}): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ConfigurationError, `expected ConfigurationError, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  });
}

export async function assertRefused({
  action,
  pattern,
}: {
  action: Promise<unknown>;
  pattern: RegExp;
}): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof RefusedError, `expected RefusedError, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  });
}
