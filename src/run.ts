import {
  BuildGroupResultSchema,
  BuildManifestSchema,
  compare,
  defaultScripts,
  type BuildGroupState,
  type BuildManifest,
  type BuildStates
} from "./util/manifest.js";
import { ensureEnv, envVariables, mode } from "./util/env.js";
import { ensureDir, pathExists } from "./util/fs.js";
import { getCommitLink, getCommitTree, getCommitDiff, maybeWrapLink } from "./util/git.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "./util/exec.js";

type Manifests = Record<string, BuildManifest>;
type ExtensionChange =
  | {
      type: "add";
      newManifest: BuildManifest;
    }
  | {
      type: "update";
      oldManifest: BuildManifest;
      newManifest: BuildManifest;
    }
  | {
      type: "remove";
      oldManifest: BuildManifest;
    };

async function getManifests(dir: string) {
  const manifests: Manifests = {};

  for (const filename of await fs.readdir(dir)) {
    if (!filename.endsWith(".json")) continue;

    const id = filename.replace(/\.json$/, "");
    const filePath = path.join(dir, filename);

    const manifestStr = await fs.readFile(filePath, "utf8");
    const manifest = BuildManifestSchema.parse(JSON.parse(manifestStr));
    manifests[id] = manifest;
  }

  return manifests;
}

async function diffManifests(manifests: Manifests, state: BuildStates) {
  const changed: Record<string, ExtensionChange> = {};
  const buildAll = mode === "all";

  for (const [id, newManifest] of Object.entries(manifests)) {
    const oldManifest = state[id]?.manifest;

    const url = new URL(newManifest.repository);
    if (url.protocol !== "https:") throw new Error("Only HTTPS Git urls are supported");

    if (oldManifest == null) {
      changed[id] = {
        type: "add",
        newManifest
      };
    } else {
      const diff =
        buildAll ||
        compare(oldManifest.repository, newManifest.repository) ||
        compare(oldManifest.commit, newManifest.commit) ||
        compare(oldManifest.scripts, newManifest.scripts) ||
        compare(oldManifest.output, newManifest.output);

      if (diff) {
        changed[id] = {
          type: "update",
          oldManifest,
          newManifest
        };
      }
    }
  }

  for (const [id, extState] of Object.entries(state)) {
    if (manifests[id] == null) {
      changed[id] = {
        type: "remove",
        oldManifest: extState!.manifest
      };
    }
  }

  return changed;
}

type BuildGroup = {
  repository: string;
  commit: string;
  scripts: string[];
  output: Partial<Record<string, string>>;

  directory: string;
  hostDirectory: string;
};

async function build(group: BuildGroup) {
  // Write the instructions for the builder
  const groupStatePath = path.join(group.directory, "state.json");
  const groupState: BuildGroupState = {
    scripts: group.scripts,
    output: group.output
  };
  await fs.writeFile(groupStatePath, JSON.stringify(groupState));

  // Run the builder (without network access!)
  await exec("docker", [
    "run",
    "--rm",

    "--net",
    "none",

    // Remember that we're using the socket from the host!
    "-v",
    `${group.hostDirectory}:/moonlight/group`,

    // Tell the container to build this group
    "-e",
    "MOONLIGHT_BUILD_MODE=group",

    "moonlight-mod/extensions-runner:latest"
  ]);

  // Pass through a schema in case it gets tampered with
  const groupResultPath = path.join(group.directory, "result.json");
  const groupResultStr = await fs.readFile(groupResultPath, "utf8");
  const groupResult = BuildGroupResultSchema.parse(JSON.parse(groupResultStr));

  return groupResult;
}

async function processGroups(groupDir: string, groupHostDir: string, changes: Record<string, ExtensionChange>) {
  const groups: Partial<Record<string, BuildGroup>> = {};
  const mapping: Partial<Record<string, string>> = {};
  let currentIdx = 0;

  for (const [id, change] of Object.entries(changes)) {
    if (change.type === "remove") continue;

    const manifest = change.newManifest;
    const scripts = manifest.scripts ?? [...defaultScripts];
    const key = `${manifest.repository}-${manifest.commit}-${JSON.stringify(scripts)}`;

    if (groups[key] == null) {
      console.log("Creating group for", id, manifest);

      // Unique ID for this prefetch directory
      const thisIdx = currentIdx++;
      const thisDir = path.join(groupDir, thisIdx.toString());
      const thisDirHost = path.join(groupHostDir, thisIdx.toString());
      await ensureDir(thisDir);

      const sourceDir = path.join(thisDir, "source");
      const storeDir = path.join(thisDir, "store");
      const outputDir = path.join(thisDir, "output");
      await ensureDir(sourceDir);
      await ensureDir(storeDir);
      await ensureDir(outputDir);

      // https://stackoverflow.com/a/3489576
      await exec("git", ["init"], {
        cwd: sourceDir
      });
      await exec("git", ["remote", "add", "origin", manifest.repository], {
        cwd: sourceDir
      });
      await exec("git", ["fetch", "origin", manifest.commit], {
        cwd: sourceDir
      });
      await exec("git", ["reset", "--hard", "FETCH_HEAD"], {
        cwd: sourceDir
      });

      // Prefetch packages into the store so we can build offline
      await exec("pnpm", ["fetch"], {
        cwd: sourceDir,
        env: {
          [envVariables.npmStoreDir]: storeDir
        }
      });

      groups[key] = {
        repository: manifest.repository,
        commit: manifest.commit,
        scripts,
        output: {},

        hostDirectory: thisDirHost,
        directory: thisDir
      };
    }

    // Add our output dir to the group config so we pack it into an .asar
    const output = manifest.output ?? `dist/${id}`;
    groups[key].output[id] = output;

    // Add our extension to the mapping so we know what group we're in
    mapping[id] = key;
  }

  return { groups, mapping };
}

export default async function run() {
  const manifestsEnv = process.env[envVariables.manifestsPath] ?? "/moonlight/manifests";
  const manifestsPath = path.join(manifestsEnv, "exts");

  const distEnv = process.env[envVariables.distPath] ?? "/moonlight/dist";
  const distPath = path.join(distEnv, "exts");
  const statePath = path.join(distEnv, "state.json");

  const workEnv = process.env[envVariables.workPath] ?? "/moonlight/work";
  const summaryPath = path.join(workEnv, "summary.md");
  await ensureDir(workEnv);

  const outputPath = path.join(workEnv, "output");
  await ensureDir(outputPath);

  const groupPath = path.join(workEnv, "group");
  await ensureDir(groupPath);

  const workHostEnv = ensureEnv(envVariables.workHostPath);
  const groupHostPath = path.join(workHostEnv, "group");

  const state: BuildStates = (await pathExists(statePath)) ? JSON.parse(await fs.readFile(statePath, "utf8")) : {};

  const manifests = await getManifests(manifestsPath);
  console.log(`Loaded ${Object.keys(manifests).length} manifests`);

  const diff = await diffManifests(manifests, state);
  console.log("Diff results:", diff);

  let summary = "# Extensions state\n\n";

  if (Object.keys(diff).length === 0) {
    console.log("No changes");
    summary += "No changes.";
  }

  // Build all extensions and get their new versions
  const { groups, mapping } = await processGroups(groupPath, groupHostPath, diff);
  console.log("Processed groups", mapping);

  const versions: Partial<Record<string, string>> = {};
  for (const [key, group] of Object.entries(groups)) {
    console.log("Building group", key);

    const result = await build(group!);
    for (const [ext, version] of Object.entries(result.versions)) {
      versions[ext] = version;
    }

    // Copy our .asars into the output directories
    const groupOutputPath = path.join(group!.directory, "output");
    for (const filename of await fs.readdir(groupOutputPath)) {
      const filePath = path.join(groupOutputPath, filename);

      const outputDestPath = path.join(outputPath, filename);
      await fs.copyFile(filePath, outputDestPath);

      const distDestPath = path.join(distPath, filename);
      await fs.copyFile(filePath, distDestPath);
    }
  }

  for (const [id, change] of Object.entries(diff)) {
    let summaryMsg = `## ${id}\n\n`;
    const oldState = state[id];

    if (change.type === "remove") {
      console.log("Removing", id);

      const asarPath = path.join(distPath, `${id}.asar`);
      await fs.rm(asarPath, { force: true });

      delete state[id];
    } else {
      const version = versions[id];
      if (version == null) throw new Error(`Couldn't get version for ${id}`);
      state[id] = {
        version,
        manifest: change.newManifest
      };
    }

    const newState = state[id];
    summaryMsg += `- Type: ${change.type}\n`;

    const repository = change.type === "remove" ? change.oldManifest.repository : change.newManifest.repository;
    summaryMsg += `- Repository: <${repository}>`;
    if (change.type === "update" && change.newManifest.repository !== change.oldManifest.repository) {
      summaryMsg += ` **(changed from <${change.oldManifest.repository}>)**`;
    }
    summaryMsg += "\n";

    if (change.type === "update") {
      const { repository, commit } = change.oldManifest;
      const link = getCommitLink(repository, commit);
      summaryMsg += `- Old commit: ${maybeWrapLink(commit, link)}`;

      const tree = getCommitTree(repository, commit);
      if (tree != null) summaryMsg += ` ([Tree](${tree}))`;

      summaryMsg += "\n";
    }

    if (change.type !== "remove") {
      const { repository, commit } = change.newManifest;
      const link = getCommitLink(repository, commit);
      summaryMsg += `- New commit: ${maybeWrapLink(commit, link)}`;

      const tree = getCommitTree(repository, commit);
      if (tree != null) summaryMsg += ` ([Tree](${tree}))`;

      if (change.type === "update" && change.oldManifest.repository === repository) {
        const diff = getCommitDiff(repository, change.oldManifest.commit, commit);
        if (diff != null) {
          summaryMsg += ` ([Diff](${diff}))`;
        }
      }

      summaryMsg += "\n";
    }

    const newVersion = newState?.version;
    if (newVersion != null) {
      summaryMsg += `- Version: ${newVersion}`;
      const oldVersion = oldState?.version;
      if (oldVersion === newVersion) summaryMsg += ` **(same version)**`;
      summaryMsg += "\n";
    }

    summaryMsg += "\n\n";
    summary += summaryMsg;
    console.log(summaryMsg.trim());
  }

  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  await fs.writeFile(summaryPath, summary.trim());
}
