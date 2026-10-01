import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

globalThis.fetch = async (input, init) => {
  assert.equal(String(input), "https://api.typesafe.ai/v1/systemone");
  const fixture = JSON.parse(await readFile(process.env.PREMISE_TEST_JEV_RESPONSE, "utf8"));
  const request = JSON.parse(init.body);
  assert.equal(request.model, "jev-1.13.0");
  assert.equal(request.questions["REVIEW-001"].type, "noul");
  for (const path of ["src/catalog.ts", "features/query.feature"]) {
    assert.equal(request.state.context[path], await readFile(join(process.cwd(), path), "utf8"));
  }
  if (fixture.unavailable) {
    return Response.json({ error: "Review service unavailable" }, { status: 503 });
  }
  return Response.json({
    model: "jev-1.13.0",
    answers: { "REVIEW-001": { type: "noul", noul: fixture.probability } },
  });
};
