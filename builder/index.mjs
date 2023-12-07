import fs from "fs";
import path from "path";
import { spawn } from "child_process";

async function exec(cmd, args, opts) {
  return await new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      ...opts,
      stdio: "inherit"
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
}

const workPath = "/work";
if (!fs.existsSync(workPath)) fs.mkdirSync(workPath);

const gitPath = path.join(workPath, "git");
const artifactPath = path.join(workPath, "artifact");

const manifestPath = path.join(workPath, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

await exec("git", ["clone", manifest.repository, gitPath]);
await exec("git", ["checkout", manifest.commit], { cwd: gitPath });

await exec("pnpm", ["install", "--recursive"], { cwd: gitPath });
for (const script of manifest.scripts) {
  await exec("pnpm", ["run", script], { cwd: gitPath });
}

const artifactFile = path.join(gitPath, manifest.artifact);
const artifactOutFile = path.join(artifactPath, process.env.EXT_ID + ".asar");
fs.copyFileSync(artifactFile, artifactOutFile);
