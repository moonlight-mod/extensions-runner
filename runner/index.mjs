import fs from "fs";
import path from "path";
import { spawn } from "child_process";

function checkEnv(name) {
  if (process.env[name] == null) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }

  return process.env[name];
}

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

const manifestsPath = checkEnv("EXT_MANIFESTS_PATH");
const distPath = checkEnv("EXT_DIST_PATH");
const workPath = checkEnv("EXT_WORK_PATH");

if (fs.existsSync(workPath)) fs.rmSync(workPath, { recursive: true });
fs.mkdirSync(workPath);

const changedPath = path.join(workPath, "changed");
if (fs.existsSync(changedPath)) fs.rmSync(changedPath, { recursive: true });
fs.mkdirSync(changedPath);

const manifests = {};
for (const file of fs.readdirSync(manifestsPath)) {
  if (!file.endsWith(".json")) continue;
  const name = file.replace(/\.json$/, "");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(manifestsPath, file), "utf8")
  );
  manifests[name] = manifest;
}

const stateFile = path.join(distPath, "state.json");
const state = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
  : {};

const changed = {};
const deleted = [];

for (const name in manifests) {
  const manifest = manifests[name];
  const old = state[name];
  if (old == null || old.commit !== manifest.commit) {
    changed[name] = manifest;
  }
}

for (const name in state) {
  if (manifests[name] == null) {
    deleted.push(name);
  }
}

console.log("Changed:", changed);
console.log("Deleted:", deleted);

if (Object.keys(changed).length === 0 && deleted.length === 0) {
  console.log("No changes");
  process.exit(0);
}

async function run(ext, manifest) {
  const extWorkPath = path.join(workPath, ext);
  const extArtifactPath = path.join(extWorkPath, "artifact");
  fs.mkdirSync(extArtifactPath, { recursive: true });

  const extManifestPath = path.join(extWorkPath, "manifest.json");
  fs.writeFileSync(extManifestPath, JSON.stringify(manifest));

  await exec("docker", [
    "run",
    "--rm",
    "-v",
    `${extArtifactPath}:/work/artifact`,
    "-v",
    `${extManifestPath}:/work/manifest.json`,
    "-e",
    `EXT_ID=${ext}`,
    "moonlight-mod/extensions-runner:latest"
  ]);

  const artifactOutFile = path.join(extArtifactPath, ext + ".asar");
  if (!fs.existsSync(artifactOutFile)) {
    console.error(`Artifact file ${artifactOutFile} not found`);
    process.exit(1);
  }

  fs.copyFileSync(artifactOutFile, path.join(distPath, "exts", ext + ".asar"));
  fs.copyFileSync(artifactOutFile, path.join(changedPath, ext + ".asar"));
  state[ext] = manifest;
}

const stateBak = { ...state };

for (const name in changed) {
  console.log(`Running ${name}`);
  await run(name, changed[name]);
}

for (const name of deleted) {
  console.log(`Deleting ${name}`);
  const asarPath = path.join(distPath, name + ".asar");
  if (fs.existsSync(asarPath)) fs.rmSync(asarPath);
  delete state[name];
}

for (const name in changed) {
  const oldCommit = stateBak[name]?.commit ?? "none";
  const newCommit = changed[name].commit;
  let msg = `${name}: ${oldCommit} -> ${newCommit}`;

  // Flawed, but w/e
  if (changed[name].repository.startsWith("https://github.com/")) {
    const repoUrl = changed[name].repository.replace(".git", "");

    let diffUrl =
      oldCommit === "none"
        ? `${repoUrl}/tree/${newCommit}`
        : `${repoUrl}/compare/${oldCommit}...${newCommit}`;
    msg += ` (${diffUrl})`;
  }

  console.log(msg);
}

for (const name of deleted) {
  const oldCommit = stateBak[name]?.commit ?? "none";
  console.log(`${name}: ${oldCommit} -> none`);
}

fs.writeFileSync(stateFile, JSON.stringify(state));
