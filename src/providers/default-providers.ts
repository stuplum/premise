import type { PremiseProvider } from "../provider.js";
import { createCucumberProvider } from "./cucumber-provider.js";
import { createDependencyCruiserProvider } from "./dependency-cruiser-provider.js";

export function createDefaultProviders({
  silentCucumber = false,
  assertInputs,
}: {
  silentCucumber?: boolean;
  assertInputs?: (paths: readonly string[]) => Promise<void>;
} = {}): PremiseProvider[] {
  return [
    createCucumberProvider({ allowEmpty: true, silent: silentCucumber, assertInputs }),
    createDependencyCruiserProvider(),
  ];
}
