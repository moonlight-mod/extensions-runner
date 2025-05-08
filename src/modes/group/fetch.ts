import { getGroupDir, readGroupState, writeGroupResult } from "./index.js";
import type { MiniGroupResult } from "../../util/manifest.js";
import { envVariables, storeDir } from "../../util/env.js";
import { exec } from "../../util/exec.js";
import { ensureDir } from "../../util/fs.js";
import path from "node:path";

export default async function runFetch() {
  const groupDir = getGroupDir();
  const groupState = await readGroupState();
  const groupResult: MiniGroupResult = {
    errors: [],
    manifests: {}
  };

  const sourceDir = path.join(groupDir, "source");
  await ensureDir(sourceDir, true);

  let failed = false;

  try {
    await exec("git", ["init", "--initial-branch=main"], {
      cwd: sourceDir
    });
    await exec("git", ["remote", "add", "origin", groupState.repository], {
      cwd: sourceDir
    });
    await exec("git", ["fetch", "origin", groupState.commit], {
      cwd: sourceDir
    });
    await exec("git", ["reset", "--hard", "FETCH_HEAD"], {
      cwd: sourceDir
    });
    await exec("git", ["submodule", "update", "--init", "--recursive"], {
      cwd: sourceDir
    });
  } catch (e) {
    console.error("Failed to clone", e);
    groupResult.errors.push({ type: "cloneFailed", err: `${e}` });
    failed = true;
  }

  if (!failed) {
    try {
      // FIXME: don't run scripts here
      await exec("pnpm", ["fetch"], {
        cwd: sourceDir,
        env: {
          PATH: process.env["PATH"],
          [envVariables.npmStoreDir]: storeDir
        }
      });
    } catch (e) {
      console.error("Failed to fetch", e);
      groupResult.errors.push({ type: "fetchFailed", err: `${e}` });
      failed = true;
    }
  }

  await writeGroupResult(groupResult);
}
