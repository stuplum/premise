import { createHash } from "node:crypto";

export function calculateFingerprint(content: string) {
  const normalizedContent = content
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");

  return `sha256:${createHash("sha256")
    .update(normalizedContent, "utf8")
    .digest("hex")}`;
}
