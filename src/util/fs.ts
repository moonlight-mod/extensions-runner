import * as fs from "node:fs/promises";
import * as path from "node:path";

export const pathExists = (path: string) =>
  fs
    .stat(path)
    .then(() => true)
    .catch(() => false);

export async function cleanDir(dir: string) {
  const isDirectory = await fs
    .stat(dir)
    .then((s) => s.isDirectory())
    .catch(() => null);

  if (isDirectory !== true) throw new Error(`Tried to clean a directory that doesn't exist: ${dir}`);

  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    const fullEntry = path.join(dir, entry);
    await fs.rm(fullEntry, { recursive: true, force: true });
  }
}

export async function ensureDir(dir: string, clean?: boolean) {
  const isDirectory = await fs
    .stat(dir)
    .then((s) => s.isDirectory())
    .catch(() => null);

  // Exists, but is a file
  if (isDirectory === false) throw new Error(`Tried to use file as directory: ${dir}`);

  // Clean if needed (removing the files inside instead of the folder since it may be mounted)
  if (clean && isDirectory === true) {
    await cleanDir(dir);
  }

  // Create if it doesn't exist
  if (isDirectory === null) await fs.mkdir(dir, { recursive: true });
}
