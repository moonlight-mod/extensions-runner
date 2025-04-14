import type { RunnerState } from "./state.js";
import { defaultGroup, defaultStore, distRepo, workDir, workHostDir } from "../../util/env.js";
import { ensureDir, pathExists } from "../../util/fs.js";
import {
  currentApiLevel,
  MiniGroupResultSchema,
  type MiniGroupResult,
  type MiniGroupState
} from "../../util/manifest.js";
import runContainer from "../../util/docker.js";
import { parseVersion, versionGreaterThan } from "../../util/version.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

type Group = {
  key: string;
  directory: string;
  hostDirectory: string; // Since this is running in Docker, we need to mount the volume from the perspective of the host

  repository: string;
  commit: string;
  scripts: string[];

  extensions: string[];
  outputs: Record<string, string>;

  result?: MiniGroupResult;
};

type GroupState = {
  groups: Group[];
};

function getWorkHostDir() {
  if (workHostDir == null) throw new Error("Work host directory not set");
  return workHostDir;
}

async function createGroups(runnerState: RunnerState) {
  const groupState: GroupState = {
    groups: []
  };

  const groupDir = path.join(workDir, "group");
  const groupHostDir = path.join(getWorkHostDir(), "group");
  await ensureDir(groupDir);

  for (const [ext, change] of Object.entries(runnerState.changes)) {
    if (change.type === "remove" || change.type === "updateNoBuild") continue;
    const manifest = change.newManifest;

    // These are the defaults for create-extension
    const scripts = manifest.scripts ?? ["build"];
    const output = manifest.output ?? `dist/${ext}`;

    // Unique key to represent this combination of repository-commit-script
    const key = `${manifest.repository}-${manifest.commit}-${JSON.stringify(scripts)}`;

    let groupIdx = groupState.groups.findIndex((group) => group.key === key);
    if (groupIdx === -1) {
      groupIdx = groupState.groups.length;
      console.log("Creating group for key", key, groupIdx);

      const thisGroupDir = path.join(groupDir, groupIdx.toString());
      const thisGroupHostDir = path.join(groupHostDir, groupIdx.toString());
      await ensureDir(thisGroupDir, true);

      groupState.groups.push({
        key,
        directory: thisGroupDir,
        hostDirectory: thisGroupHostDir,

        repository: manifest.repository,
        commit: manifest.commit,
        scripts: scripts,

        extensions: [],
        outputs: {}
      });
    }

    console.log("Adding extension", ext, "to", groupIdx);
    const group = groupState.groups[groupIdx];
    if (group == null) {
      console.warn("Group is null");
      runnerState.warnings.push({ type: "unknown" });
    }

    group.extensions.push(ext);
    group.outputs[ext] = output;
  }

  return groupState;
}

async function writeGroupState(group: Group, state: MiniGroupState) {
  const groupStatePath = path.join(group.directory, "state.json");
  await fs.writeFile(groupStatePath, JSON.stringify(state));
}

async function readGroupResult(group: Group) {
  const groupResultPath = path.join(group.directory, "result.json");
  const groupResultStr = await fs.readFile(groupResultPath, "utf8");
  return MiniGroupResultSchema.parse(JSON.parse(groupResultStr));
}

async function writeGroupResult(group: Group, result: MiniGroupResult) {
  const groupResultPath = path.join(group.directory, "result.json");
  await fs.writeFile(groupResultPath, JSON.stringify(result));
}

async function propagateErrors(runnerState: RunnerState, group: Group, result: MiniGroupResult) {
  const sharedExts = [];
  for (const ext of group.extensions) {
    const change = runnerState.changes[ext];
    if (change == null) {
      console.warn("Null change when propagating errors", ext, result);
      runnerState.warnings.push({ type: "unknown" });
      continue;
    }
    sharedExts.push(change);
  }

  for (const error of result.errors) {
    switch (error.type) {
      case "cloneFailed":
      case "fetchFailed":
      case "installFailed": {
        for (const change of sharedExts) {
          change.errors.push({ type: error.type, err: error.err });
        }
        break;
      }

      case "scriptFailed": {
        for (const change of sharedExts) {
          change.errors.push({ type: "scriptFailed", script: error.script, err: error.err });
        }
        break;
      }

      case "packageFailed": {
        const change = runnerState.changes[error.ext];
        if (change == null) {
          console.warn("Null change when propagating package failed error", error);
          runnerState.warnings.push({ type: "unknown" });
          continue;
        }
        change.errors.push({ type: "packageFailed", err: error.err });
        break;
      }
    }
  }
}

async function buildGroup(runnerState: RunnerState, group: Group) {
  const storeDir = path.join(workDir, "store");
  const storeHostDir = path.join(getWorkHostDir(), "store");
  await ensureDir(storeDir);

  const groupOutputDir = path.join(group.directory, "output");
  const groupOutputHostDir = path.join(group.hostDirectory, "output");
  await ensureDir(groupOutputDir, true);

  const distOutputDir = path.join(distRepo, "exts");
  await ensureDir(distOutputDir);

  const artifactOutputDir = path.join(workDir, "output");
  await ensureDir(artifactOutputDir);

  // Only pass in what the build needs to know
  await writeGroupState(group, {
    repository: group.repository,
    commit: group.commit,
    scripts: group.scripts,
    outputs: group.outputs
  });

  // Write this so we can mount it
  await writeGroupResult(group, {
    errors: [],
    manifests: {}
  });

  // Fetch dependencies (with network access)
  // FIXME: pnpm fetch is buggy for this use case right now, re-evaluate if we should use this in prod
  await runContainer({
    Image: "moonlight-mod/extensions-runner:latest",
    Env: ["MOONLIGHT_BUILD_MODE=fetch"],
    Tty: true,
    HostConfig: {
      AutoRemove: true,
      Mounts: [
        {
          Target: path.join(defaultGroup, "state.json"),
          Source: path.join(group.hostDirectory, "state.json"),
          Type: "bind",
          ReadOnly: true
        },
        {
          Target: path.join(defaultGroup, "result.json"),
          Source: path.join(group.hostDirectory, "result.json"),
          Type: "bind"
        },
        {
          Target: path.join(defaultGroup, "source"),
          Source: path.join(group.hostDirectory, "source"),
          Type: "bind"
          // FIXME: make this readonly when pnpm stops creating `node_modules` after running fetch
        },
        {
          // SECURITY ASSUMPTION: poisoning the pnpm store is not possible
          // if this is possible (either a pnpm bug or someone gets code exec) then whelp I fucked up
          Target: defaultStore,
          Source: storeHostDir,
          Type: "bind"
        }
      ]
    }
  });

  let result = await readGroupResult(group);
  if (result.errors.length !== 0) {
    console.error("Fetch failed", group, result);
    await propagateErrors(runnerState, group, result);
    return;
  }

  // Build (without network access)
  await runContainer({
    Image: "moonlight-mod/extensions-runner:latest",
    Env: ["MOONLIGHT_BUILD_MODE=build"],
    Tty: true,
    NetworkDisabled: true,
    HostConfig: {
      AutoRemove: true,
      Mounts: [
        {
          Target: path.join(defaultGroup, "state.json"),
          Source: path.join(group.hostDirectory, "state.json"),
          Type: "bind",
          ReadOnly: true
        },
        {
          Target: path.join(defaultGroup, "result.json"),
          Source: path.join(group.hostDirectory, "result.json"),
          Type: "bind"
        },
        {
          Target: path.join(defaultGroup, "source"),
          Source: path.join(group.hostDirectory, "source"),
          Type: "bind"
        },
        {
          Target: defaultStore,
          Source: storeHostDir,
          Type: "bind",
          ReadOnly: true // store doesn't need to be writable anymore
        },
        {
          Target: path.join(defaultGroup, "output"),
          Source: groupOutputHostDir,
          Type: "bind"
        }
      ]
    }
  });

  result = await readGroupResult(group);
  if (result.errors.length !== 0) {
    console.error("Build failed", group, result);
    await propagateErrors(runnerState, group, result);
    return;
  }

  for (const [ext, manifest] of Object.entries(result.manifests)) {
    const change = runnerState.changes[ext];
    if (change == null) {
      console.warn("Null change when applying build results", ext, result);
      runnerState.warnings.push({ type: "unknown" });
      continue;
    }

    // This should never happen, but just in case
    if (change.type !== "add" && change.type !== "update") {
      console.warn("Mismatched change type when applying build result", ext, result, change);
      runnerState.warnings.push({ type: "unknown" });
      continue;
    }

    runnerState.buildState[ext] = {
      version: manifest.version,
      manifest: change.newManifest
    };

    if (manifest.apiLevel !== currentApiLevel) {
      // Manifest does not specify API level or it is mismatched
      change.warnings.push({ type: "invalidApiLevel", value: manifest.apiLevel });
    }

    if (manifest.id !== ext) {
      // Extension ID is mismatched between CI and the manifest
      change.warnings.push({ type: "invalidId", value: manifest.id });
    }

    const ver = manifest.version != null ? parseVersion(manifest.version) : null;
    const oldState = runnerState.oldBuildState[ext];

    if (manifest.version != null && oldState?.version != null && manifest.version === oldState.version) {
      // Version string is the same
      change.warnings.push({ type: "sameOrLowerVersion", oldVersion: oldState.version, newVersion: manifest.version });
    }

    // Version parsing isn't enforced by moonlight, but we'll check in case we want to in the future
    if (ver == null) {
      // Couldn't parse version
      change.warnings.push({ type: "irregularVersion" });
    } else if (change.type === "update" && oldState?.version != null) {
      const oldVer = parseVersion(oldState.version, true);

      if (oldVer != null && !versionGreaterThan(ver, oldVer)) {
        // Version string was parsed and it's a downgrade
        change.warnings.push({
          type: "sameOrLowerVersion",
          oldVersion: oldState.version,
          newVersion: manifest.version!
        });
      }
    }

    const asarFilename = `${ext}.asar`;
    const asarOutputPath = path.join(groupOutputDir, asarFilename);
    const asarDistPath = path.join(distOutputDir, asarFilename);
    const asarArtifactPath = path.join(artifactOutputDir, asarFilename);

    if (!(await pathExists(asarOutputPath))) {
      console.warn("Output .asar does not exist", ext, change, manifest);
      change.errors.push({ type: "packageFailed", err: "Output .asar does not exist" });
      continue;
    }

    // Copy into extensions-dist
    await fs.copyFile(asarOutputPath, asarDistPath);

    // Copy into the build artifact folder (remember, this is the group-specific output folder so far)
    await fs.copyFile(asarOutputPath, asarArtifactPath);
  }
}

export default async function build(runnerState: RunnerState) {
  const groupState = await createGroups(runnerState);

  for (const group of groupState.groups) {
    try {
      await buildGroup(runnerState, group);
    } catch (e) {
      console.error("Failed to build group", e);

      for (const ext of group.extensions) {
        const change = runnerState.changes[ext];
        if (change == null) {
          console.warn("Null change when propagating uncaught error", ext);
          runnerState.warnings.push({ type: "unknown" });
          continue;
        }

        change.errors.push({ type: "unknown", err: `${e}` });
      }
    }
  }

  // Handle deletes separately to builds
  try {
    const distOutputDir = path.join(distRepo, "exts");
    await ensureDir(distOutputDir);

    for (const [ext, change] of Object.entries(runnerState.changes)) {
      if (change.type !== "remove") continue;

      const asarFilename = `${ext}.asar`;
      const asarDistPath = path.join(distOutputDir, asarFilename);
      if (await pathExists(asarDistPath)) await fs.rm(asarDistPath, { force: true });

      delete runnerState.buildState[ext];
    }
  } catch (e) {
    console.error(e);
    runnerState.errors.push({ type: "deleteChangeFailed", err: `${e}` });
  }
}
