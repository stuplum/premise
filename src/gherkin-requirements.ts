import { generateMessages } from "@cucumber/gherkin";
import { IdGenerator, SourceMediaType } from "@cucumber/messages";

export function requirementIds({
  content,
  uri,
}: {
  content: string;
  uri: string;
}): string[] {
  const envelopes = generateMessages(
    content,
    uri,
    SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
    {
      includeGherkinDocument: false,
      includePickles: true,
      includeSource: false,
      newId: IdGenerator.incrementing(),
    },
  );

  return [
    ...new Set(
      envelopes
        .flatMap((envelope) => envelope.pickle?.tags ?? [])
        .map((tag) => tag.name)
        .filter((tag) => /^@[A-Z][A-Z0-9]*-\d+$/.test(tag))
        .map((tag) => tag.slice(1)),
    ),
  ];
}
