import { execFileSync } from "node:child_process";

export function git({ projectDirectory, args }: { projectDirectory: string; args: string[] }): string {
  return execFileSync(
    "git",
    ["-c", "user.email=premise@example.com", "-c", "user.name=Premise", "-c", "init.defaultBranch=main", ...args],
    { cwd: projectDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

export function commitAll({ projectDirectory, message }: { projectDirectory: string; message: string }): string {
  if (!insideWorkTree(projectDirectory)) {
    git({ projectDirectory, args: ["init", "-q"] });
  }
  git({ projectDirectory, args: ["add", "-A"] });
  git({ projectDirectory, args: ["commit", "-q", "--allow-empty", "-m", message] });
  return git({ projectDirectory, args: ["rev-parse", "HEAD"] }).trim();
}

function insideWorkTree(projectDirectory: string): boolean {
  try {
    return git({ projectDirectory, args: ["rev-parse", "--is-inside-work-tree"] }).trim() === "true";
  } catch {
    return false;
  }
}
