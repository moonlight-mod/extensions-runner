import { authorId, authorPr, authorUsername, buildMode, distRepo, manifestsRepo } from "../../util/env.js";
import { pathExists } from "../../util/fs.js";
import {
  BuildManifestSchema,
  hasChanged,
  moonlightReviewers,
  type BuildManifest,
  type BuildState
} from "../../util/manifest.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// Based off of BuildGroupResult
export type ExtensionError =
  // Unhandled exceptions
  | {
      type: "unknown";
      err: string;
    }
  // Logged "properly" by BuildGroupResult
  | {
      type: "cloneFailed";
      err: string;
    }
  | {
      type: "fetchFailed";
      err: string;
    }
  | {
      type: "installFailed";
      err: string;
    }
  | {
      type: "scriptFailed";
      script: string;
      err: string;
    }
  | {
      type: "packageFailed";
      err: string;
    };

export type ExtensionWarning =
  // Extension manifest warnings
  | {
      type: "invalidApiLevel";
      value?: number;
    }
  | {
      type: "invalidId";
      value: string;
    }
  | {
      type: "irregularVersion";
      value?: string;
    }
  | {
      type: "sameOrLowerVersion";
      oldVersion: string;
      newVersion: string;
    }
  // Build manifest warnings
  | {
      type: "noOwnersSpecified";
    }
  | {
      type: "repositoryChanged";
    }
  | {
      type: "buildConfigChanged";
    }
  | {
      type: "authorNotInOwners";
    }
  | {
      type: "ownersChanged";
    }
  | {
      type: "authorAddedToOwners";
    };

export type ExtensionChange = {
  errors: ExtensionError[];
  warnings: ExtensionWarning[];
} & (
  | {
      type: "add";
      newManifest: BuildManifest;
    }
  | {
      type: "updateNoBuild";
      oldManifest: BuildManifest;
      newManifest: BuildManifest;
    }
  | {
      type: "update";
      oldManifest: BuildManifest;
      newManifest: BuildManifest;
    }
  | {
      type: "remove";
      oldManifest: BuildManifest;
    }
);

// FIXME: warning for out-of-sync or conflicting PR
export type RunnerWarning =
  | {
      type: "unknown";
    }
  | {
      type: "missingAuthor";
    };

export type RunnerError =
  | {
      type: "parseManifestFailed";
      ext: string;
      err: string;
    }
  | {
      type: "deleteChangeFailed";
      err: string;
    };

export type RunnerAuthor = {
  username: string;
  id: string;
  pr?: string;
};

export type RunnerState = {
  author?: RunnerAuthor;
  warnings: RunnerWarning[];
  errors: RunnerError[];
  oldBuildState: BuildState;
  buildState: BuildState;
  changes: Record<string, ExtensionChange>;
};

function authorCanEdit(manifest: BuildManifest, author: RunnerAuthor) {
  return (
    manifest.owners == null ||
    moonlightReviewers.includes(author.id) ||
    manifest.owners.some((owner) => owner === author.username || owner === `id:${author.id}`)
  );
}

async function getManifests(runnerState: RunnerState, dir: string) {
  const manifests: Record<string, BuildManifest> = {};

  for (const filename of await fs.readdir(dir)) {
    if (!filename.endsWith(".json")) continue;

    const ext = filename.replace(/\.json$/, "");
    const filePath = path.join(dir, filename);

    try {
      const manifestStr = await fs.readFile(filePath, "utf8");
      const manifest = BuildManifestSchema.parse(JSON.parse(manifestStr));
      manifests[ext] = manifest;
    } catch (e) {
      runnerState.errors.push({ type: "parseManifestFailed", ext: ext, err: `${e}` });
    }
  }

  return manifests;
}

async function diffManifests(runnerState: RunnerState, manifests: Record<string, BuildManifest>) {
  const changed: Record<string, ExtensionChange> = {};

  for (const [ext, newManifest] of Object.entries(manifests)) {
    const oldManifest = runnerState.oldBuildState[ext]?.manifest;

    const url = new URL(newManifest.repository);
    if (url.protocol !== "https:") throw new Error("Only HTTPS Git URLs are supported");
    if (url.username !== "" || url.password !== "") throw new Error("Cannot provide credentials to Git repository");

    if (oldManifest == null) {
      // Build a new extension
      const change: ExtensionChange = {
        warnings: [],
        errors: [],

        type: "add",
        newManifest
      };

      if (newManifest.owners != null) {
        if (runnerState.author != null && !authorCanEdit(newManifest, runnerState.author)) {
          // Author forgot to add themselves to the owner list
          change.warnings.push({ type: "authorNotInOwners" });
        }
      } else {
        // Author forgot to add an owner list
        change.warnings.push({ type: "noOwnersSpecified" });
      }

      runnerState.changes[ext] = change;
    } else {
      const repositoryChanged = hasChanged(oldManifest.repository, newManifest.repository);
      // Count a repo change as a commit change too just to be safe
      const commitChanged = repositoryChanged || hasChanged(oldManifest.commit, newManifest.commit);

      // Changes to the way the build system runs
      const buildConfigChanged =
        hasChanged(oldManifest.scripts, newManifest.scripts) || hasChanged(oldManifest.output, newManifest.output);
      const ownersChanged = hasChanged(oldManifest.owners, newManifest.owners);

      const shouldBuild = buildMode === "all" || commitChanged || buildConfigChanged;
      const shouldUpdate = shouldBuild || ownersChanged;

      let change: ExtensionChange;
      if (shouldBuild) {
        // Build the new version
        change = {
          warnings: [],
          errors: [],

          type: "update",
          oldManifest,
          newManifest
        };
      } else if (shouldUpdate) {
        // Emit a change without a rebuild, just to stick a warning in
        change = {
          warnings: [],
          errors: [],

          type: "updateNoBuild",
          oldManifest,
          newManifest
        };
      } else {
        // No change here, just move on
        continue;
      }

      if (newManifest.owners == null) {
        // Extension does not have any owners yet
        change.warnings.push({ type: "noOwnersSpecified" });
      }

      if (repositoryChanged) {
        // Repository URL changed (*not* commit)
        change.warnings.push({ type: "repositoryChanged" });
      }

      if (buildConfigChanged) {
        // Build config changed (even if repo/commit is the same)
        change.warnings.push({ type: "buildConfigChanged" });
      }

      if (ownersChanged) {
        // Author added/removed owners
        change.warnings.push({ type: "ownersChanged" });
      }

      if (runnerState.author != null) {
        const ownerForOld = authorCanEdit(oldManifest, runnerState.author);
        const ownerForNew = authorCanEdit(newManifest, runnerState.author);

        if (!ownerForNew) {
          // Author isn't in the owners list (!!!)
          change.warnings.push({ type: "authorNotInOwners" });
        }

        if (!ownerForOld && ownerForNew) {
          // Author added themselves to the owners list (!!!!!)
          change.warnings.push({ type: "authorAddedToOwners" });
        }
      }

      runnerState.changes[ext] = change;
    }
  }

  for (const [id, extState] of Object.entries(runnerState.oldBuildState)) {
    if (manifests[id] == null) {
      // Removed a previous extension
      runnerState.changes[id] = {
        warnings: [],
        errors: [],

        type: "remove",
        oldManifest: extState.manifest
      };
    }
  }

  return changed;
}

export default async function computeState() {
  const buildStatePath = path.join(distRepo, "state.json");
  const oldBuildState: BuildState = (await pathExists(buildStatePath))
    ? JSON.parse(await fs.readFile(buildStatePath, "utf8"))
    : {};
  console.log(`Loaded ${Object.keys(oldBuildState).length} state entries`);

  const runnerState: RunnerState = {
    author:
      authorId != null && authorUsername != null
        ? {
            id: authorId,
            username: authorUsername,
            pr: authorPr
          }
        : undefined,
    warnings: [],
    errors: [],
    oldBuildState,
    buildState: JSON.parse(JSON.stringify(oldBuildState)),
    changes: {}
  };

  if (buildMode === "pr" && runnerState.author == null) {
    // CI isn't providing the author right (maybe the workflow is broken?)
    runnerState.warnings.push({ type: "missingAuthor" });
  }

  const extManifestsDir = path.join(manifestsRepo, "exts");
  const manifests = await getManifests(runnerState, extManifestsDir);
  console.log(`Loaded ${Object.keys(manifests).length} manifests`);

  await diffManifests(runnerState, manifests);
  console.log(`Processing ${Object.keys(runnerState.changes).length} changes`);

  return runnerState;
}
