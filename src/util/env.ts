export const envVariables = {
  buildMode: "MOONLIGHT_BUILD_MODE",
  authorId: "MOONLIGHT_AUTHOR_ID",
  authorUsername: "MOONLIGHT_AUTHOR_USERNAME",
  authorPr: "MOONLIGHT_AUTHOR_PR",

  manifestsPath: "MOONLIGHT_MANIFESTS_PATH",
  distPath: "MOONLIGHT_DIST_PATH",
  workPath: "MOONLIGHT_WORK_PATH",
  workHostPath: "MOONLIGHT_WORK_HOST_PATH",

  groupPath: "MOONLIGHT_GROUP_PATH",
  storePath: "MOONLIGHT_STORE_PATH",

  npmStoreDir: "NPM_CONFIG_STORE_DIR"
};

export type BuildMode = "push" | "pr" | "all" | "fetch" | "build";
export const buildMode = (process.env[envVariables.buildMode] ?? null) as BuildMode | null;

export const defaultManifests = "/moonlight/manifests";
export const defaultDist = "/moonlight/dist";
export const defaultWork = "/moonlight/work";

export const manifestsRepo = process.env[envVariables.manifestsPath] ?? defaultManifests;
export const distRepo = process.env[envVariables.distPath] ?? defaultDist;
export const workDir = process.env[envVariables.workPath] ?? defaultWork;
export const workHostDir = process.env[envVariables.workHostPath];

export const defaultGroup = "/moonlight/group";
export const defaultStore = "/moonlight/store";

export const groupDir = process.env[envVariables.groupPath] ?? defaultGroup;
export const storeDir = process.env[envVariables.storePath] ?? defaultStore;

export const authorId = process.env[envVariables.authorId];
export const authorUsername = process.env[envVariables.authorUsername];
export const authorPr = process.env[envVariables.authorPr];
