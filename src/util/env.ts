export const envVariables = {
  manifestsPath: "MOONLIGHT_MANIFESTS_PATH",
  distPath: "MOONLIGHT_DIST_PATH",
  workPath: "MOONLIGHT_WORK_PATH",
  workHostPath: "MOONLIGHT_WORK_HOST_PATH",
  groupPath: "MOONLIGHT_GROUP_PATH",
  buildMode: "MOONLIGHT_BUILD_MODE",

  npmStoreDir: "NPM_CONFIG_STORE_DIR"
};

export type BuildMode = "all" | "group" | null;
export const mode = (process.env[envVariables.buildMode] ?? null) as BuildMode;

export function ensureEnv(name: string) {
  if (process.env[name] == null) throw new Error(`Missing environment variable: ${name}`);
  return process.env[name];
}
