import { createHash } from "node:crypto";
import { watch, type BigIntStats, type FSWatcher } from "node:fs";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import { discoverCucumberRepositoryPaths } from "./cucumber-output-paths.js";
import { readConfiguration } from "./repository.js";

export type RepositoryVerification = {
  fingerprint: string;
  current(signal: AbortSignal): Promise<boolean>;
  dispose(): void;
};

export type RepositorySnapshot = {
  assertInputs(uris: readonly string[]): Promise<void>;
  fingerprint(signal: AbortSignal): Promise<string>;
  verify(signal: AbortSignal): Promise<RepositoryVerification>;
};

type FingerprintObserver = {
  observeSymlinkTarget(path: string, directory: boolean): void;
  record(path: string, stats: BigIntStats): void;
};

const excluded: Record<string, true> = {
  ".premise/agent-sessions": true,
  ".premise/agent-feedback": true,
};
const defaultFeaturePaths = ["features/**/*.feature"];
const defaultStepPaths = ["features/step_definitions/**/*.ts"];

export async function createRepositorySnapshot(
  projectDirectory: string,
  signal: AbortSignal,
): Promise<RepositorySnapshot> {
  const canonicalProjectDirectory = await realpath(projectDirectory);
  const configuration = await readConfiguration({
    projectDirectory: canonicalProjectDirectory,
  });
  const cucumberPaths = await discoverCucumberRepositoryPaths(
    canonicalProjectDirectory,
    signal,
  );
  signal.throwIfAborted();
  const inputPatterns = [
    ...cucumberPaths.inputs,
    ...(configuration.cucumber?.features ?? defaultFeaturePaths),
    ...(configuration.cucumber?.steps ?? defaultStepPaths),
  ];
  const inputPaths = new Set(
    (
      await glob(inputPatterns, {
        absolute: true,
        cwd: canonicalProjectDirectory,
        dot: true,
        follow: true,
        nodir: false,
      })
    ).map((path) => resolve(path)),
  );
  const canonicalInputPaths = new Set(
    await Promise.all(
      [...inputPaths].map((path) => realpath(path).catch(() => path)),
    ),
  );
  const declaredOutputPaths = cucumberPaths.outputs
    .map((path) => resolve(canonicalProjectDirectory, path));
  const outputPaths = new Set([
    ...declaredOutputPaths,
    ...(await Promise.all(declaredOutputPaths.map(canonicalizePath))),
    ...(await Promise.all(
      declaredOutputPaths.map(async (path) =>
        join(await canonicalizePath(dirname(path)), basename(path)),
      ),
    )),
  ]);

  async function isGeneratedOutput({
    logicalPath,
    physicalPath,
  }: { logicalPath: string; physicalPath: string }): Promise<boolean> {
    const absoluteLogicalPath = resolve(logicalPath);
    const absolutePhysicalPath = resolve(physicalPath);
    if (
      !outputPaths.has(absoluteLogicalPath) &&
      !outputPaths.has(absolutePhysicalPath)
    ) {
      return false;
    }
    const canonicalPath = await realpath(absoluteLogicalPath);
    if (
      inputPaths.has(absoluteLogicalPath) ||
      inputPaths.has(absolutePhysicalPath) ||
      canonicalInputPaths.has(canonicalPath)
    ) {
      return false;
    }
    const stats = await lstat(absoluteLogicalPath);
    if (stats.isFile()) {
      return true;
    }
    if (!stats.isSymbolicLink()) {
      return false;
    }
    const targetStats = await lstat(canonicalPath);
    return targetStats.isFile();
  }

  async function fingerprint(
    fingerprintSignal: AbortSignal,
    observer?: FingerprintObserver,
  ): Promise<string> {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const ancestors = new Set<string>();

    async function visit({
      path,
      uri,
      logicalPath,
    }: { path: string; uri: string; logicalPath: string }): Promise<void> {
      fingerprintSignal.throwIfAborted();
      const before = await lstat(path, { bigint: true });
      fingerprintSignal.throwIfAborted();
      hash.update(JSON.stringify([uri, Number(before.mode)]));
      if (before.isSymbolicLink()) {
        const target = await readlink(path);
        const canonicalTarget = await realpath(path);
        const targetStats = await lstat(canonicalTarget);
        observer?.observeSymlinkTarget(
          canonicalTarget,
          targetStats.isDirectory(),
        );
        hash.update(JSON.stringify(["link", target]));
        await visit({ path: canonicalTarget, uri, logicalPath });
      } else if (before.isDirectory()) {
        const canonical = await realpath(path);
        if (ancestors.has(canonical)) {
          throw new Error(
            `Cannot fingerprint cyclic directory link at ${uri || "."}`,
          );
        }
        ancestors.add(canonical);
        try {
          const names = (await readdir(path)).sort();
          for (const name of names) {
            const child = uri ? `${uri}/${name}` : name;
            const childPath = join(path, name);
            const childLogicalPath = join(logicalPath, name);
            if (
              name !== ".git" &&
              name !== "node_modules" &&
              !Object.hasOwn(excluded, child) &&
              !(await isGeneratedOutput({ logicalPath: childLogicalPath, physicalPath: childPath }))
            ) {
              await visit({ path: childPath, uri: child, logicalPath: childLogicalPath });
            }
          }
        } finally {
          ancestors.delete(canonical);
        }
      } else if (before.isFile()) {
        hash.update(JSON.stringify(["file", before.size.toString()]));
        const file = await open(path, "r");
        try {
          let position = 0;
          while (true) {
            fingerprintSignal.throwIfAborted();
            const { bytesRead } = await file.read(
              buffer,
              0,
              buffer.length,
              position,
            );
            if (bytesRead === 0) {
              break;
            }
            hash.update(buffer.subarray(0, bytesRead));
            position += bytesRead;
          }
        } finally {
          await file.close();
        }
      } else {
        throw new Error(
          `Cannot fingerprint non-regular repository entry ${uri}`,
        );
      }
      const after = await lstat(path, { bigint: true });
      if (
        before.ino !== after.ino ||
        before.mode !== after.mode ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs
      ) {
        throw new Error(
          `Repository changed while fingerprinting ${
            uri || "."
          }; wait for writes to finish and retry completion`,
        );
      }
      observer?.record(path, after);
      fingerprintSignal.throwIfAborted();
    }

    await visit({ path: canonicalProjectDirectory, uri: "", logicalPath: canonicalProjectDirectory });
    return hash.digest("hex");
  }

  return {
    async assertInputs(uris) {
      if (outputPaths.size === 0) {
        return;
      }
      const canonicalOutputs = new Set(await Promise.all(declaredOutputPaths.map(canonicalizePath)));
      for (const uri of uris) {
        if (!uri.startsWith("file:") && !isAbsolute(uri) && /^[a-z][a-z0-9+.-]*:/i.test(uri)) {
          continue;
        }
        const path = uri.startsWith("file:") ? fileURLToPath(uri) : resolve(canonicalProjectDirectory, uri);
        const canonicalPath = await canonicalizePath(path);
        if (outputPaths.has(path) || outputPaths.has(canonicalPath) || canonicalOutputs.has(canonicalPath)) {
          throw new Error(`Cucumber report output overlaps executable evidence at ${uri}; write reports to a separate output file`);
        }
      }
    },
    fingerprint,
    async verify(verificationSignal) {
      const watchers = new Map<string, FSWatcher>();
      const manifest = new Map<string, BigIntStats>();
      let invalidated = false;
      let disposed = false;
      const invalidate = () => {
        invalidated = true;
      };
      const dispose = () => {
        if (disposed) {
          return;
        }
        disposed = true;
        verificationSignal.removeEventListener("abort", dispose);
        for (const watcher of watchers.values()) {
          watcher.close();
        }
        watchers.clear();
      };
      const observe = (path: string, recursive: boolean) => {
        if (
          disposed ||
          watchers.has(path) ||
          (path !== canonicalProjectDirectory &&
            isWithin({ parent: canonicalProjectDirectory, child: path }))
        ) {
          return;
        }
        const watcher = watch(
          path,
          { persistent: false, recursive },
          invalidate,
        );
        watcher.on("error", invalidate);
        watchers.set(path, watcher);
      };
      verificationSignal.addEventListener("abort", dispose, { once: true });
      try {
        verificationSignal.throwIfAborted();
        observe(canonicalProjectDirectory, true);
        const verifiedFingerprint = await fingerprint(verificationSignal, {
          observeSymlinkTarget: observe,
          record(path, stats) {
            if (path !== canonicalProjectDirectory) {
              manifest.set(path, stats);
            }
          },
        });
        verificationSignal.throwIfAborted();
        if (invalidated) {
          throw new Error(
            "Repository changed while verifying completion; wait for writes to finish and retry completion",
          );
        }
        return {
          fingerprint: verifiedFingerprint,
          async current(currentSignal) {
            currentSignal.throwIfAborted();
            await nextTurn();
            currentSignal.throwIfAborted();
            if (disposed || invalidated) {
              return false;
            }
            for (const [path, expected] of manifest) {
              currentSignal.throwIfAborted();
              let actual: BigIntStats;
              try {
                actual = await lstat(path, { bigint: true });
              } catch {
                return false;
              }
              if (!sameEntry({ left: expected, right: actual })) {
                return false;
              }
            }
            await nextTurn();
            currentSignal.throwIfAborted();
            return !disposed && !invalidated;
          },
          dispose,
        };
      } catch (error) {
        dispose();
        throw error;
      }
    },
  };
}

function isWithin({ parent, child }: { parent: string; child: string }): boolean {
  const relativePath = relative(parent, child);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

async function canonicalizePath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    const parent = dirname(path);
    if (parent === path) {
      throw error;
    }
    return join(await canonicalizePath(parent), basename(path));
  }
}

function sameEntry({ left, right }: { left: BigIntStats; right: BigIntStats }): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}
