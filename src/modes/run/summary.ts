import { buildMode, workDir, type BuildMode } from "../../util/env.js";
import { getCommitDiff, getCommitLink, getCommitTree } from "../../util/git.js";
import { currentApiLevel } from "../../util/manifest.js";
import type { ExtensionChange, RunnerState } from "./state.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const buildModeEmojis: Partial<Record<BuildMode, [string, string]>> = {
  push: [":shipit:", "push"],
  pr: [":hammer:", "PR"]
};

const changeEmojis: Record<ExtensionChange["type"], [string, string]> = {
  add: [":new:", "New extension."],
  update: [":repeat:", "Updating extension."],
  updateNoBuild: [":repeat_one:", "Updating build manifest."],
  remove: [":put_litter_in_its_place:", "Deleting extension."] // I swear I'm not being mean that emoji shortcode is just rude
};

function filterByType<T extends { type: string }[]>(values: T) {
  return [...values]
    .reduce(
      (prev, current) => {
        return prev.some((i) => i.type === current.type) ? prev : ([...prev, current] as T);
      },
      [] as unknown as T
    )
    .sort();
}

function formatCommit(repository: string, commit: string, oldCommit?: string) {
  let result = "";

  const link = getCommitLink(repository, commit);
  if (link != null) {
    result += `[${commit}](${link})`;
  } else {
    result += commit;
  }

  const tree = getCommitTree(repository, commit);
  if (tree != null) result += ` ([Tree](${tree}))`;

  if (oldCommit != null) {
    const diff = getCommitDiff(repository, oldCommit, commit);
    if (diff != null) result += ` ([Diff](${diff}))`;
  }

  return result;
}

export default async function writeSummary(state: RunnerState) {
  let summary = "# Extensions state\n\n";

  const modeEmoji = buildMode != null ? buildModeEmojis[buildMode] : null;
  if (modeEmoji != null) {
    summary += `- ${modeEmoji[0]} Running in ${modeEmoji[1]} mode.\n`;
    if (state.author != null) {
      summary +=
        state.author.pr != null
          ? `  - Running on behalf of \`${state.author.username}\` for PR ${state.author.pr}.\n`
          : `  - Running on behalf of \`${state.author.username}\`.\n`;
    }
  }

  const allChanges = Object.values(state.changes);
  const successCount = allChanges.filter((change) => change.errors.length === 0 && change.warnings.length === 0).length;
  const warnCount = allChanges.filter((change) => change.errors.length === 0 && change.warnings.length !== 0).length;
  const failCount = allChanges.filter((change) => change.errors.length !== 0).length;

  const warningMergeMessage = "Review all warnings before merging.";
  const errorMergeMessage = "Do not merge.";

  if (allChanges.length !== 0) {
    summary += `- Processed ${allChanges.length} extension change(s).\n`;
    if (successCount !== 0) summary += `  - :white_check_mark: ${successCount} extension(s) built successfully.\n`;
    if (warnCount !== 0) {
      summary += `  - :warning: ${warnCount} extension(s) **built with warnings**.`;
      if (buildMode === "pr") summary += ` ${warningMergeMessage}`;
      summary += "\n";
    }
    if (failCount !== 0) {
      summary += `  - :x: ${failCount} extension(s) **failed to build**.`;
      if (buildMode === "pr") summary += ` ${errorMergeMessage}`;
      summary += "\n";
    }
  } else {
    summary += `- No extension changes.\n`;
  }

  if (state.warnings.length !== 0) {
    summary += `- :warning: Runner completed with **${state.warnings.length} warning(s).**\n`;

    for (const warning of filterByType(state.warnings)) {
      switch (warning.type) {
        case "unknown": {
          summary += `  - **Unknown warning.** Check the build log for more info.\n`;
          break;
        }

        case "missingAuthor": {
          summary += `  - **Author context is missing.** Check that the build workflows are correct.\n`;
          break;
        }
      }
    }
  }

  if (state.errors.length !== 0) {
    summary += `- :x: Runner completed with **${state.errors.length} error(s).**\n`;

    for (const error of filterByType(state.errors)) {
      switch (error.type) {
        case "parseManifestFailed": {
          summary += `  - **Build manifests failed to parse.** Check that all manifests are valid.\n`;
          break;
        }

        case "deleteChangeFailed": {
          summary += `  - **Failed to delete extensions.** Check the build log for more info.\n`;
          break;
        }
      }
    }
  }

  summary += "\n";

  for (const [ext, change] of Object.entries(state.changes)) {
    summary += `## ${ext}\n\n`;

    const [emoji, typeName] = changeEmojis[change.type];
    summary += `- ${emoji} ${typeName}\n`;

    if (change.type === "remove" || change.type === "add") {
      const manifest = change.type === "remove" ? change.oldManifest : change.newManifest;
      summary += `- Repository: <${manifest.repository}>\n`;
      summary += `- Commit: ${formatCommit(manifest.repository, manifest.commit)}\n`;
    } else {
      if (change.oldManifest.repository !== change.newManifest.repository) {
        summary += `- Old repository: <${change.oldManifest.repository}>\n`;
        summary += `- New repository: <${change.newManifest.repository}>\n`;
      } else {
        summary += `- Repository: <${change.newManifest.repository}>\n`;
      }

      if (change.oldManifest.commit !== change.newManifest.commit) {
        summary += `- Old commit: ${formatCommit(change.oldManifest.repository, change.oldManifest.commit)}\n`;

        // Don't show diff URL if repository changed
        const newCommit =
          change.oldManifest.repository === change.newManifest.repository
            ? formatCommit(change.newManifest.repository, change.newManifest.commit, change.oldManifest.commit)
            : formatCommit(change.newManifest.repository, change.newManifest.commit);
        summary += `- New commit: ${newCommit}\n`;
      } else {
        summary += `- Commit: ${formatCommit(change.newManifest.repository, change.newManifest.commit)}\n`;
      }

      // Theoretically this will only be null if there are already warnings/errors for it, so this should be safe
      const oldBuildState = state.oldBuildState[ext];
      const buildState = state.buildState[ext];
      if (buildState != null && buildState.version != null) {
        if (oldBuildState != null && oldBuildState.version != null) {
          summary += `- Old version: ${oldBuildState.version}\n`;
          summary += `- New version: ${buildState.version}\n`;
        } else {
          summary += `- Version: ${buildState.version}\n`;
        }
      }
    }

    if (change.errors.length === 0 && change.warnings.length === 0) {
      summary += `- :white_check_mark: Built successfully.\n`;
    } else if (change.errors.length === 0 && change.warnings.length !== 0) {
      summary += `- :warning: **Built with warnings.**`;
      if (buildMode === "pr") summary += ` ${warningMergeMessage}`;
      summary += "\n";
    } else {
      summary += `- :x: **Failed to build.**`;
      if (buildMode === "pr") summary += ` ${errorMergeMessage}`;
      summary += "\n";
    }

    for (const warning of filterByType(change.warnings)) {
      switch (warning.type) {
        case "invalidApiLevel": {
          summary += `  - **Invalid API level** (expected ${currentApiLevel}, got ${warning.value ?? "none"}). This extension will not load in moonlight.\n`;
          break;
        }

        case "invalidId": {
          summary += `  - **Mismatched IDs** (expected ${ext}, got ${warning.value}). Ensure the same ID is used across all manifests.\n`;
          break;
        }

        case "irregularVersion": {
          if (warning.value == null) {
            summary += `  - **Missing version.** Updates may fail in Moonbase.\n`;
          } else {
            summary += `  - **Irregular version** (got ${warning.value}). This does not currently cause issues, but using a standard version format may be required in the future.\n`;
          }
          break;
        }

        case "sameOrLowerVersion": {
          if (warning.newVersion === warning.oldVersion) {
            summary += `  - **Same version.** Updates will fail in Moonbase.\n`;
          } else {
            summary += `  - **Downgraded version.** This does not currently cause issues, but always incrementing versions may be required in the future.\n`;
          }
          break;
        }

        case "noOwnersSpecified": {
          summary += `  - **No owners specified.** This should be set to prevent extension hijacking.\n`;
          break;
        }

        case "repositoryChanged": {
          summary += `  - **Repository changed.** Check that the new repository is not malicious.\n`;
          break;
        }

        case "buildConfigChanged": {
          summary += `  - **Build config changed.** Recheck the build script and output artifact.\n`;
          break;
        }

        case "authorNotInOwners": {
          summary += `  - **Author not in owners.** Check that the author has permission to update this extension.\n`;
          break;
        }

        case "ownersChanged": {
          summary += `  - **Owners changed.** Check that all owners should be able to update this extension.\n`;
          break;
        }

        case "authorAddedToOwners": {
          summary += `  - **Author added themselves to owners.** Check that the author has permission to adopt this extension.\n`;
          break;
        }
      }
    }

    for (const error of filterByType(change.errors)) {
      switch (error.type) {
        case "unknown": {
          summary += `  - **Unknown error.** Check the build log for more info.\n`;
          break;
        }

        case "cloneFailed": {
          summary += `  - **Clone failed.** Check that the target Git forge is online.\n`;
          break;
        }

        case "fetchFailed": {
          summary += `  - **Fetch failed.** Check that the lockfile is up to date. The extension repository might be broken, or this might be a bug in the runner.\n`;
          break;
        }

        case "installFailed": {
          summary += `  - **Install failed.** Check that the lockfile is up to date. The extension repository might be broken, or this might be a bug in the runner.\n`;
          break;
        }

        case "scriptFailed": {
          summary += `  - **Running script ${error.script} failed.** The extension repository might be broken, or this might be a bug in the runner.\n`;
          break;
        }

        case "packageFailed": {
          summary += `  - **Package failed.** Check that the output path is correct. This might be a bug in the runner.\n`;
          break;
        }
      }
    }

    summary += "\n";
  }

  // newline to make my markdown linting chimpanzee brain happy
  const summaryPath = path.join(workDir, "summary.md");
  await fs.writeFile(summaryPath, summary.trim() + "\n");
}
