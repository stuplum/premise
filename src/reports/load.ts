import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "glob";
import { CONFIG_FILE } from "../config.js";
import { ConfigurationError } from "../errors.js";
import type { Config } from "../model.js";
import { compareText } from "../text.js";
import { parseCucumberJson } from "./cucumber-json.js";
import { parseDependencyCruiser } from "./dependency-cruiser.js";
import { parseJunit } from "./junit.js";
import type { Reports } from "./model.js";

export async function loadReports({
  projectDirectory,
  config,
}: {
  projectDirectory: string;
  config: Config;
}): Promise<Reports> {
  const loaded: Reports = { cases: [], rules: [] };
  for (const report of config.reports) {
    const uris = await reportFiles({ projectDirectory, pattern: report.path });
    if (uris.length === 0) {
      throw new ConfigurationError(`${CONFIG_FILE}: report ${report.path} matches no file`);
    }
    for (const uri of uris) {
      const content = await readFile(join(projectDirectory, uri), "utf8");
      if (report.format === "dependency-cruiser") {
        loaded.rules.push(...parseDependencyCruiser({ content, uri }));
      } else if (report.format === "junit") {
        loaded.cases.push(...parseJunit({ content, uri }));
      } else {
        loaded.cases.push(...parseCucumberJson({ content, uri }));
      }
    }
  }
  return loaded;
}

export async function reportFiles({
  projectDirectory,
  pattern,
}: {
  projectDirectory: string;
  pattern: string;
}): Promise<string[]> {
  const uris = await glob(pattern, { cwd: projectDirectory, nodir: true, dot: true, posix: true });
  return uris.sort(compareText);
}
