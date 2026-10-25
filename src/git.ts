import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigurationError } from "./errors.js";

const execFileAsync = promisify(execFile);
const maxBuffer = 64 * 1024 * 1024;

export async function requireCommit({ projectDirectory, ref }: { projectDirectory: string; ref: string }): Promise<void> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: projectDirectory });
  } catch {
    throw new ConfigurationError(`--base ${ref} is not a commit`);
  }
}

export async function readAtRef({
  projectDirectory,
  ref,
  uri,
}: {
  projectDirectory: string;
  ref: string;
  uri: string;
}): Promise<string | undefined> {
  try {
    await execFileAsync("git", ["cat-file", "-e", `${ref}:./${uri}`], { cwd: projectDirectory });
  } catch {
    return undefined;
  }
  const { stdout } = await execFileAsync("git", ["show", `${ref}:./${uri}`], { cwd: projectDirectory, encoding: "utf8", maxBuffer });
  return stdout;
}

export async function filesAtRef({ projectDirectory, ref }: { projectDirectory: string; ref: string }): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-tree", "-r", "-z", "--name-only", ref], {
    cwd: projectDirectory,
    encoding: "utf8",
    maxBuffer,
  });
  return stdout.split("\0").filter((uri) => uri.length > 0);
}

export async function commitAdding({
  projectDirectory,
  ref,
  uri,
  text,
}: {
  projectDirectory: string;
  ref: string;
  uri: string;
  text: string;
}): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%H", `-S${text}`, ref, "--", uri], {
      cwd: projectDirectory,
      encoding: "utf8",
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
