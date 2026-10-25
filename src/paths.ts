import { isAbsolute, sep } from "node:path";

export function leavesDirectory(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}
