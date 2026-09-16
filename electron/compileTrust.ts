// Compile-trust guards (P0 #4).
//
// External compilers (latexmk, asymptote) are spawned with a working directory
// of the open project. Lexical containment checks are not enough: a directory
// symlink, file symlink, or Windows junction inside the project can silently
// point outside it, so a hostile project could trick the compiler into
// reading/writing files anywhere on the machine. These routines re-verify
// containment using canonical (realpath) locations before a compiler runs.

import { realpath } from "node:fs/promises";
import path from "node:path";

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Verify that `targetPath` is a real file whose canonical location stays inside
 * the canonical `projectPath`. Throws when the target is missing, or when a
 * symlink/junction escapes the project root.
 */
export async function assertCanonicalCompileInside(
  projectPath: string,
  targetPath: string,
): Promise<void> {
  const canonicalProject = await realpath(path.resolve(projectPath));

  // Walk up from the target to the deepest existing ancestor (the root file
  // itself must exist to compile), then re-append the missing tail and compare
  // canonical locations.
  let ancestor = path.resolve(targetPath);
  const missingParts: string[] = [];
  let canonicalAncestor: string | null = null;
  while (canonicalAncestor === null) {
    try {
      canonicalAncestor = await realpath(ancestor);
    } catch {
      if (path.dirname(ancestor) === ancestor) {
        throw new Error("The compilation root file could not be found.");
      }
      missingParts.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }

  const resolvedTarget = path.join(canonicalAncestor, ...missingParts);
  if (!isInside(canonicalProject, resolvedTarget)) {
    throw new Error(
      "The compilation root escapes the open project via a symbolic link.",
    );
  }
}

/** Convenience wrapper: assert containment and return the target path. */
export async function canonicalCompileTarget(
  projectPath: string,
  targetPath: string,
): Promise<string> {
  await assertCanonicalCompileInside(projectPath, targetPath);
  return await realpath(targetPath).catch(() => targetPath);
}
