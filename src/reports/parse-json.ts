import { ConfigurationError } from "../errors.js";
import { errorMessage } from "../text.js";

export function parseJson({ content, uri }: { content: string; uri: string }): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new ConfigurationError(`${uri}: invalid JSON: ${errorMessage(error)}`);
  }
}
