import { compileFeatureExecutions } from "./compiled-context.js";
import { evaluatePremises } from "./provider.js";
import { createCucumberProvider } from "./providers/cucumber-provider.js";

export async function runExecutableRequirements({
  projectDirectory,
}: {
  projectDirectory: string;
}) {
  const evaluations = await evaluatePremises({
    projectDirectory,
    providers: [createCucumberProvider()],
  });
  for (const { result } of evaluations) {
    if (result.status === "unknown") {
      process.stderr.write(`${result.reason}\n`);
    }
  }
  if (evaluations.some(({ result }) => result.status !== "established")) {
    return false;
  }

  await compileFeatureExecutions({
    executions: evaluations.map(({ premise, result }) => ({
      artifacts:
        result.status === "established"
          ? (result.evidence ?? [])
              .filter(({ role }) => role === "executed")
              .map(({ uri }) => uri)
          : [],
      source: premise.assertion.ref.uri,
    })),
    projectDirectory,
  });
  return true;
}
