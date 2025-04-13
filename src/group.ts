import asar from "@electron/asar";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  currentApiLevel,
  ExtensionManifestSchema,
  type BuildGroupResult,
  type BuildGroupState
} from "./util/manifest.js";
import { exec } from "./util/exec.js";
import { envVariables } from "./util/env.js";
import { pathExists } from "./util/fs.js";

export default async function buildGroup() {
  const groupPath = process.env[envVariables.groupPath] ?? "/moonlight/group";

  const groupStatePath = path.join(groupPath, "state.json");
  const groupState: BuildGroupState = JSON.parse(await fs.readFile(groupStatePath, "utf8"));

  const sourceDir = path.join(groupPath, "source");
  const storeDir = path.join(groupPath, "store");
  const outputDir = path.join(groupPath, "output");

  await exec(
    "pnpm",
    [
      "install",
      "--frozen-lockfile",
      "--offline",
      "--config.confirmModulesPurge=false", // auto-confirm yes to remaking node_modules
      "--config.managePackageManagerVersions=false" // skip trying to pin pnpm without the network
    ],
    {
      cwd: sourceDir,
      env: {
        PATH: process.env["PATH"],
        [envVariables.npmStoreDir]: storeDir
      }
    }
  );

  for (const script of groupState.scripts) {
    await exec("pnpm", ["run", script], {
      cwd: sourceDir,
      env: {
        PATH: process.env["PATH"],
        [envVariables.npmStoreDir]: storeDir
      }
    });
  }

  const result: BuildGroupResult = {
    versions: {}
  };

  for (const [id, output] of Object.entries(groupState.output)) {
    const normalized = path.normalize(output!);
    if (normalized.startsWith(".")) throw new Error(`Detected possible path traversal: ${normalized}`);

    const folder = path.join(sourceDir, output!);
    if (!(await pathExists(folder))) throw new Error(`Missing output directory for ${id}: ${folder}`);

    const manifestPath = path.join(folder, "manifest.json");
    if (!(await pathExists(manifestPath))) throw new Error(`Missing manifest for ${id}: ${manifestPath}`);
    const manifestStr = await fs.readFile(manifestPath, "utf8");

    const manifest = ExtensionManifestSchema.parse(JSON.parse(manifestStr));
    if (manifest.version == null) throw new Error(`Missing version for ${id}`);
    if (manifest.apiLevel !== currentApiLevel) {
      throw new Error(`Mismatched API level (expected ${currentApiLevel}, got ${manifest.apiLevel ?? "none"})`);
    }
    result.versions[id] = manifest.version;

    const file = path.join(outputDir, `${id}.asar`);
    await asar.createPackage(folder, file);
  }

  const groupResultPath = path.join(groupPath, "result.json");
  await fs.writeFile(groupResultPath, JSON.stringify(result));
}
