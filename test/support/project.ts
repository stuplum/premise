import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

export async function createProject({
  t,
  files,
}: {
  t: TestContext;
  files: Record<string, string>;
}): Promise<string> {
  const projectDirectory = await mkdtemp(join(tmpdir(), "premise-"));
  t.after(() => rm(projectDirectory, { recursive: true, force: true }));
  await writeFiles({ projectDirectory, files });
  return projectDirectory;
}

export async function writeFiles({
  projectDirectory,
  files,
}: {
  projectDirectory: string;
  files: Record<string, string>;
}): Promise<void> {
  for (const [uri, content] of Object.entries(files)) {
    const path = join(projectDirectory, uri);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}
