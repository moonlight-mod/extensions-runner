import { getGroupDir, readGroupResult, readGroupState, writeGroupResult } from "./index.js";
import { envVariables, storeDir } from "../../util/env.js";
import { exec } from "../../util/exec.js";
import { pathExists } from "../../util/fs.js";
import { ExtensionManifestSchema } from "../../util/manifest.js";
import * as fs from "node:fs/promises";
import path from "node:path";
import asar from "@electron/asar";

export default async function runBuild() {
  const groupDir = getGroupDir();
  const groupState = await readGroupState();
  const groupResult = await readGroupResult();

  const sourceDir = path.join(groupDir, "source");
  const outputDir = path.join(groupDir, "output");

  let failed = false;

  try {
    await exec(
      "pnpm",
      [
        "install",
        "--frozen-lockfile",
        "--offline",

        // FIXME: https://github.com/orgs/pnpm/discussions/9418
        "--config.confirmModulesPurge=false", // auto-confirm yes to remaking node_modules
        "--config.managePackageManagerVersions=false" // skip trying to pin pnpm without the network
      ],
      {
        cwd: sourceDir,
        env: {
          // Not entirely sure why this is needed to forward the path
          PATH: process.env["PATH"],
          [envVariables.npmStoreDir]: storeDir
        }
      }
    );
  } catch (e) {
    console.error("Failed to install", e);
    groupResult.errors.push({ type: "installFailed", err: `${e}` });
    failed = true;
  }

  if (!failed) {
    for (const script of groupState.scripts) {
      try {
        await exec("pnpm", ["run", script], {
          cwd: sourceDir,
          env: {
            PATH: process.env["PATH"],
            [envVariables.npmStoreDir]: storeDir
          }
        });
      } catch (e) {
        console.error("Failed to run script", script, e);
        groupResult.errors.push({ type: "scriptFailed", script, err: `${e}` });
        failed = true;
        break;
      }
    }
  }

  if (!failed) {
    for (const [ext, outputPath] of Object.entries(groupState.outputs)) {
      try {
        const normalized = path.normalize(outputPath);
        if (normalized.startsWith(".")) throw new Error(`Detected possible path traversal: ${normalized}`);

        const extOutputDir = path.join(sourceDir, normalized);
        if (!(await pathExists(extOutputDir))) throw new Error(`Missing output directory: ${extOutputDir}`);

        const manifestPath = path.join(extOutputDir, "manifest.json");
        if (!(await pathExists(manifestPath))) throw new Error(`Missing manifest: ${manifestPath}`);

        const manifestStr = await fs.readFile(manifestPath, "utf8");
        const manifest = ExtensionManifestSchema.parse(JSON.parse(manifestStr));

        const asarOutputPath = path.join(outputDir, `${ext}.asar`);
        await asar.createPackage(extOutputDir, asarOutputPath);

        groupResult.manifests[ext] = manifest;
      } catch (e) {
        console.error("Failed to package", e);
        groupResult.errors.push({ type: "packageFailed", ext, err: `${e}` });
        failed = true;
      }
    }
  }

  await writeGroupResult(groupResult);
}
