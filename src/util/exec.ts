import { spawn, type SpawnOptions } from "node:child_process";

export function exec(cmd: string, args: string[], opts?: SpawnOptions): Promise<void> {
  return new Promise((resolve, reject) => {
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
