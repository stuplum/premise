import { createWriteStream } from "node:fs";
import { deserialize, serialize } from "node:v8";
import { cruise, type ICruiseOptions, type ICruiseResult, type IForbiddenRuleType } from "dependency-cruiser";
import extractDependencyCruiserOptions from "dependency-cruiser/config-utl/extract-depcruise-options";

export type DependencyCruiserOptions = {
  encoded: string;
  ruleSet: { forbidden: IForbiddenRuleType[] };
};

export type DependencyCruiserRequest =
  | { configPath: string }
  | { options: string; projectDirectory: string; sourcePaths: string[] };

export type DependencyCruiserResponse =
  | { options: DependencyCruiserOptions }
  | { result: ICruiseResult }
  | { error: string };

let response: DependencyCruiserResponse;
try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const request = JSON.parse(Buffer.concat(chunks).toString()) as DependencyCruiserRequest;
  if ("configPath" in request) {
    const options = await extractDependencyCruiserOptions(request.configPath);
    response = {
      options: {
        encoded: serialize(options).toString("base64"),
        ruleSet: { forbidden: options.ruleSet?.forbidden ?? [] },
      },
    };
  } else {
    const result = await cruise(request.sourcePaths, {
      ...deserialize(Buffer.from(request.options, "base64")) as ICruiseOptions,
      baseDir: request.projectDirectory,
      outputType: undefined,
      validate: true,
    });
    if (typeof result.output === "string") {
      throw new Error("dependency-cruiser returned an unexpected result");
    }
    response = { result: result.output };
  }
} catch (error) {
  response = { error: error instanceof Error ? error.message : String(error) };
}
createWriteStream("", { fd: 3 }).end(JSON.stringify(response, (_key, value) =>
  value instanceof RegExp ? { $premiseRegExp: [value.source, value.flags] } : value,
));
