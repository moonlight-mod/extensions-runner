import { distRepo, workDir } from "../../util/env.js";
import { ensureDir } from "../../util/fs.js";
import computeState from "./state.js";
import build from "./build.js";
import writeSummary from "./summary.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export default async function run() {
  await ensureDir(workDir, true);

  const outputDir = path.join(workDir, "output");
  await ensureDir(outputDir);

  const groupDir = path.join(workDir, "group");
  await ensureDir(groupDir);

  const runnerState = await computeState();
  await build(runnerState);

  // This is included for debugging locally, this isn't uploaded anywhere
  const runnerStatePath = path.join(workDir, "runnerState.json");
  await fs.writeFile(runnerStatePath, JSON.stringify(runnerState));

  // This is used by extensions-dist
  const buildStatePath = path.join(distRepo, "state.json");
  await fs.writeFile(buildStatePath, JSON.stringify(runnerState.buildState, null, 2));

  // This is included for CI previews
  await writeSummary(runnerState);

  const shouldFail =
    runnerState.errors.length !== 0 || Object.values(runnerState.changes).some((change) => change.errors.length !== 0);
  if (shouldFail) {
    console.log("Exiting with errors :(");
    process.exit(1);
  } else {
    console.log("aight cya");

    // Clean up after ourselves since we won't need to debug anything
    // (leave output/summary/state for CI though)
    await fs.rm(groupDir, { recursive: true, force: true });

    // `storeDir` global is for the fetch/build modes
    const storeDir = path.join(workDir, "store");
    await fs.rm(storeDir, { recursive: true, force: true });
  }
}
