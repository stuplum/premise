import { compilePremiseEvaluations } from "./compiled-context.js";
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

  await compilePremiseEvaluations({ evaluations, projectDirectory });
  return true;
}
