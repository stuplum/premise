import { generateMessages } from "@cucumber/gherkin";
import {
  IdGenerator,
  SourceMediaType,
  type Examples,
  type Feature,
  type Location,
  type Pickle,
  type Rule,
  type Scenario,
  type Tag,
} from "@cucumber/messages";

type GherkinRequirement = {
  id: string;
  node: Feature | Rule | Scenario | Examples;
  pickles: Pickle[];
  tag: Tag;
};

export function discoverGherkinRequirements({
  content,
  uri,
}: {
  content: string;
  uri: string;
}): { feature?: Feature; requirements: GherkinRequirement[] } {
  const envelopes = generateMessages(
    content,
    uri,
    SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
    {
      includeGherkinDocument: true,
      includePickles: true,
      includeSource: false,
      newId: IdGenerator.incrementing(),
    },
  );
  const errors = envelopes.flatMap((envelope) =>
    envelope.parseError ? [envelope.parseError] : [],
  );
  if (errors.length > 0) {
    throw new Error(
      errors
        .map((error) =>
          `${sourceLocation(uri, error.source.location)}: Invalid Gherkin: ${error.message}`,
        )
        .join("\n"),
    );
  }

  const feature = envelopes.find((envelope) => envelope.gherkinDocument)
    ?.gherkinDocument?.feature;
  const requirements = new Map<string, GherkinRequirement>();
  const declarations = new Map<string, GherkinRequirement>();

  function discoverNode(node: GherkinRequirement["node"]) {
    for (const tag of node.tags) {
      if (!/^@[A-Z][A-Z0-9]*-\d+$/.test(tag.name)) {
        continue;
      }
      const id = tag.name.slice(1);
      const existing = requirements.get(id);
      if (existing) {
        throw new Error(
          `Duplicate requirement ID ${id}: ${sourceLocation(uri, existing.tag.location)}, ${sourceLocation(uri, tag.location)}`,
        );
      }
      const requirement: GherkinRequirement = { id, node, pickles: [], tag };
      requirements.set(id, requirement);
      declarations.set(tag.id, requirement);
    }
    if ("children" in node) {
      for (const child of node.children) {
        if (child.scenario) {
          discoverNode(child.scenario);
        } else if ("rule" in child && child.rule) {
          discoverNode(child.rule);
        }
      }
    } else if ("examples" in node) {
      for (const examples of node.examples) {
        discoverNode(examples);
      }
    }
  }

  if (feature) {
    discoverNode(feature);
  }
  for (const { pickle } of envelopes) {
    if (!pickle) {
      continue;
    }
    for (const tag of pickle.tags) {
      declarations.get(tag.astNodeId)?.pickles.push(pickle);
    }
  }
  for (const requirement of requirements.values()) {
    if (!requirement.pickles.some((pickle) => pickle.steps.length > 0)) {
      throw new Error(
        `${sourceLocation(uri, requirement.tag.location)}: Requirement ID ${requirement.id} on ${requirement.node.keyword}: ${requirement.node.name} selects no executable scenarios or rows`,
      );
    }
  }
  return { feature, requirements: [...requirements.values()] };
}

function sourceLocation(uri: string, location?: Location) {
  return `${uri}:${location?.line ?? 1}:${location?.column ?? 1}`;
}
