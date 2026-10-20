import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export class PathGuardError extends Error {
  readonly code = "PATH_OUTSIDE_PROJECT";
  constructor(message: string) {
    super(message);
    this.name = "PathGuardError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Resolve a user/agent supplied path inside a project root. Rejects absolute
 * paths, traversal, NUL bytes, and symlinks whose real target escapes the root.
 */
export function resolveInsideRoot(root: string, candidate: string): string {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new PathGuardError("path is required");
  }
  if (candidate.includes("\0")) throw new PathGuardError("path contains a NUL byte");
  if (path.isAbsolute(candidate)) throw new PathGuardError("absolute paths are not allowed");
  const canonicalRoot = realpathSync(root);
  const target = path.resolve(canonicalRoot, candidate);
  if (target !== canonicalRoot && !isInside(canonicalRoot, target)) {
    throw new PathGuardError(`path escapes project root: ${candidate}`);
  }

  let existing = target;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    tail.unshift(path.basename(existing));
    existing = parent;
  }
  const realExisting = realpathSync(existing);
  const realTarget = path.resolve(realExisting, ...tail);
  if (realTarget !== canonicalRoot && !isInside(canonicalRoot, realTarget)) {
    throw new PathGuardError(`path resolves outside project root: ${candidate}`);
  }
  return realTarget;
}

export function relativeInsideRoot(root: string, absolute: string): string {
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathGuardError("path is not inside project root");
  }
  return relative.split(path.sep).join("/");
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function shortHash(value: string, length = 12): string {
  return sha256(value).slice(0, length);
}
