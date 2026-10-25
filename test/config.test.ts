import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { assertConfigurationError } from "./support/assertions.js";
import { configFile } from "./support/fixtures.js";
import { createProject } from "./support/project.js";

test("a minimal configuration defaults to human sign-off and no classifiers", async (t) => {
  const projectDirectory = await createProject({ t, files: configFile() });

  const config = await loadConfig({ projectDirectory });

  assert.deepEqual(config.signoff, { default: "human", allowed: ["human"] });
  assert.deepEqual(config.classifiers, {});
  assert.deepEqual(config.reports, [{ format: "junit", path: "reports/unit.xml" }]);
});

test("a missing premise.yaml is a configuration error", async (t) => {
  const projectDirectory = await createProject({ t, files: {} });

  await assertConfigurationError({
    action: loadConfig({ projectDirectory }),
    pattern: /premise\.yaml: cannot be read/,
  });
});

test("an unknown key is rejected and names the file", async (t) => {
  const projectDirectory = await createProject({ t, files: configFile({ verbose: true }) });

  await assertConfigurationError({ action: loadConfig({ projectDirectory }), pattern: /^premise\.yaml: / });
});

test("allowing a classifier that is not configured is rejected", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: configFile({ signoff: { default: "human", allowed: ["human", "classifier:jev"] } }),
  });

  await assertConfigurationError({
    action: loadConfig({ projectDirectory }),
    pattern: /classifiers\.jev is not configured/,
  });
});

test("a default sign-off outside the allowed list is rejected", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: configFile({ signoff: { default: "none", allowed: ["human"] } }),
  });

  await assertConfigurationError({
    action: loadConfig({ projectDirectory }),
    pattern: /signoff\.default none is not in signoff\.allowed/,
  });
});

test("a failed threshold at or above established is rejected", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: configFile({
      signoff: { default: "human", allowed: ["human", "classifier:jev"] },
      classifiers: { jev: { adapter: "jev", model: "jev-1.13.0", thresholds: { established: 0.5, failed: 0.5 } } },
    }),
  });

  await assertConfigurationError({
    action: loadConfig({ projectDirectory }),
    pattern: /classifiers\.jev\.thresholds\.failed must be below established/,
  });
});

test("a jev classifier must pin a model version", async (t) => {
  const projectDirectory = await createProject({
    t,
    files: configFile({
      classifiers: { jev: { adapter: "jev", model: "jev-latest", thresholds: { established: 0.8, failed: 0.2 } } },
    }),
  });

  await assertConfigurationError({ action: loadConfig({ projectDirectory }), pattern: /premise\.yaml/ });
});

test("a dependency-cruiser config that is not JSON is rejected", async (t) => {
  const projectDirectory = await createProject({ t, files: configFile({ dependency_cruiser_config: ".dependency-cruiser.js" }) });

  await assertConfigurationError({ action: loadConfig({ projectDirectory }), pattern: /premise\.yaml/ });
});
