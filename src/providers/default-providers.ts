import type { PremiseProvider } from "../provider.js";
import { createCucumberProvider } from "./cucumber-provider.js";
import { createDependencyCruiserProvider } from "./dependency-cruiser-provider.js";

export function createDefaultProviders({
  silentCucumber = false,
}: {
  silentCucumber?: boolean;
} = {}): PremiseProvider[] {
  return [
    createCucumberProvider({ allowEmpty: true, silent: silentCucumber }),
    createDependencyCruiserProvider(),
  ];
}
