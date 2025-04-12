export type GitRepository = {
  type: "github";
  owner: string;
  repo: string;
};

export function parseRepository(repository: string): GitRepository | null {
  const url = new URL(repository);

  if (url.hostname === "github.com") {
    const path = url.pathname.replace(/\.git$/, "").replace(/^\//, "");
    const [owner, repo] = path.split("/");
    return { type: "github", owner, repo };
  }

  // TODO: other git forges?
  return null;
}

export function getCommitLink(repository: string, commit: string) {
  const parsed = parseRepository(repository);

  switch (parsed?.type) {
    case "github": {
      return `https://github.com/${parsed.owner}/${parsed.repo}/commit/${commit}`;
    }
  }

  return undefined;
}

export function getCommitTree(repository: string, commit: string) {
  const parsed = parseRepository(repository);

  switch (parsed?.type) {
    case "github": {
      return `https://github.com/${parsed.owner}/${parsed.repo}/tree/${commit}`;
    }
  }

  return undefined;
}

export function getCommitDiff(repository: string, oldCommit: string, newCommit: string) {
  const parsed = parseRepository(repository);

  switch (parsed?.type) {
    case "github": {
      return `https://github.com/${parsed.owner}/${parsed.repo}/compare/${oldCommit}...${newCommit}`;
    }
  }

  return undefined;
}

// kinda meh about this being in this file but w/e
export function maybeWrapLink(text: string, link?: string) {
  if (link != null) {
    return `[${text}](${link})`;
  } else {
    return text;
  }
}
