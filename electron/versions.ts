export interface NormalizedLatexDoVersion {
  core: string[];
  prerelease: string[];
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeLatexDoVersion(version: string): NormalizedLatexDoVersion {
  const normalized = version.trim().replace(/^v/i, "");
  const hyphenIndex = normalized.indexOf("-");
  const corePart = hyphenIndex === -1 ? normalized : normalized.slice(0, hyphenIndex);
  const prereleasePart = hyphenIndex === -1 ? "" : normalized.slice(hyphenIndex + 1);
  return {
    core: corePart.split(".").filter(Boolean),
    prerelease: prereleasePart.split(/[.-]/).filter(Boolean),
  };
}

function compareVersionPart(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);

  if (bothNumeric) {
    return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
  }

  return left === right ? 0 : left > right ? 1 : -1;
}

export function compareLatexDoVersions(left: string, right: string): number {
  const leftVersion = normalizeLatexDoVersion(left);
  const rightVersion = normalizeLatexDoVersion(right);
  const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length);

  for (let index = 0; index < coreLength; index += 1) {
    const comparison = compareVersionPart(
      leftVersion.core[index] ?? "0",
      rightVersion.core[index] ?? "0",
    );
    if (comparison !== 0) {
      return comparison;
    }
  }

  // A release outranks any pre-release of the same version (semver rule).
  if (!leftVersion.prerelease.length || !rightVersion.prerelease.length) {
    return (
      Number(Boolean(rightVersion.prerelease.length)) -
      Number(Boolean(leftVersion.prerelease.length))
    );
  }

  const prereleaseLength = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const comparison = compareVersionPart(leftPart, rightPart);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function versionsEquivalent(left: string, right: string): boolean {
  return compareLatexDoVersions(left, right) === 0;
}

export function isBuildReleaseSlugForVersion(
  release: string,
  version: string,
): boolean {
  return new RegExp(
    `^v${escapeRegExpLiteral(version)}-build\\.\\d+\\.\\d+\\.[a-f0-9]{12}$`,
  ).test(release);
}

export function isReleaseSlugForVersion(release: string, version: string): boolean {
  return release === `v${version}` || isBuildReleaseSlugForVersion(release, version);
}
