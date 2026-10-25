export function tagTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 1 && token.startsWith("@"))
    .map((token) => token.slice(1));
}
