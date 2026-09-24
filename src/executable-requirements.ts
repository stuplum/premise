import { compilePremiseEvaluations } from "./compiled-context.js";
import { evaluatePremises } from "./provider.js";
import { createDefaultProviders } from "./providers/default-providers.js";

export async function runExecutableRequirements({
  projectDirectory,
}: {
  projectDirectory: string;
}) {
  const evaluations = await evaluatePremises({
    projectDirectory,
    providers: createDefaultProviders(),
  });
  if (evaluations.length === 0) {
    process.stderr.write("No executable requirements matched\n");
    return false;
  }
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
