// we have semver at home
export type ParsedVersion = [number, number, number];

const regex = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(version: string, silent: boolean = false) {
  try {
    const matches = regex.exec(version);
    if (matches == null) return null;
    return [matches[1], matches[2], matches[3]].map((value) => parseInt(value)) as ParsedVersion;
  } catch (e) {
    if (!silent) console.warn("Failed to parse version", version, e);
    return null;
  }
}

export function versionGreaterThan(newVersion: ParsedVersion, oldVersion: ParsedVersion) {
  return (
    newVersion[0] > oldVersion[0] ||
    (newVersion[0] === oldVersion[0] && newVersion[1] > oldVersion[1]) ||
    (newVersion[0] === oldVersion[0] && newVersion[1] === oldVersion[1] && newVersion[2] > oldVersion[2])
  );
}
