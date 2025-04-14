import { spawn, type SpawnOptions } from "node:child_process";

export async function exec(cmd: string, args: string[] = [], opts?: SpawnOptions) {
  const code = await new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      ...opts,
      stdio: "inherit"
    });

    proc.on("error", reject);
    proc.on("close", (code) => resolve(code));
  });

  if (code !== 0) throw new Error(`Process exited with code ${code}`);
}
