import * as fs from "node:fs/promises";
import * as path from "node:path";

export const pathExists = (path: string) =>
  fs
    .stat(path)
    .then(() => true)
    .catch(() => false);

export async function ensureDir(path: string) {
  const isDirectory = await fs
    .stat(path)
    .then((s) => s.isDirectory())
    .catch(() => null);

  // Exists, but is a file
  if (isDirectory === false) throw new Error(`Tried to use file as directory: ${path}`);

  // Create if it doesn't exist
  if (isDirectory === null) await fs.mkdir(path, { recursive: true });
}

export async function recursiveCopy(src: string, dst: string) {
  for (const filename of await fs.readdir(src)) {
    const srcPath = path.join(src, filename);
    const dstPath = path.join(dst, filename);

    const isDirectory = (await fs.stat(srcPath)).isDirectory();
    if (isDirectory) {
      await ensureDir(dstPath);
      await recursiveCopy(srcPath, dstPath);
    } else {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}
