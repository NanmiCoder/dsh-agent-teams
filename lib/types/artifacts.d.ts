/**
 * Workspace byte identity: the only module in this plugin that reads artifact
 * bytes off disk.
 *
 * Two plugin surfaces need it:
 *  · a quality verdict must record which revision it judged (issue #161), so
 *    delivery can refuse to advertise bytes no review ever saw;
 *  · an auto-generated work order must record the workspace it was derived
 *    from (issue #174), so it can be marked stale after a later round edits a
 *    cited file.
 *
 * Safety rules this module must never lose:
 *  · directory traversal never follows symlinks, and every explicitly named
 *    path is resolved with `realpath` and rejected when it leaves the
 *    workspace — a symlink must not become a read of arbitrary host files, and
 *    a symlink cycle must not become an infinite walk;
 *  · a scope that cannot be enumerated completely (file cap, unreadable
 *    directory, non-workspace-relative path) produces an explicit
 *    {@link ArtifactScopeGap} instead of a short list that reads as complete;
 *  · "could not be read" is recorded separately from "does not exist";
 *  · plugins and secrets never enter a broad scope by accident.
 *
 * The gate rules themselves stay pure: they receive {@link ArtifactDigest}
 * values from here and never touch the filesystem.
 * @module dsh-agent-teams/artifacts
 */
import type { ArtifactDigest, ArtifactScopeGap, ArtifactSnapshot } from './types.ts';
/**
 * Upper bound on files expanded from one scope. Verdicts are about a revision
 * and an unbounded walk of a large tree would make every gate close slow, so
 * the walk stops here — and says so with a gap, because a silently truncated
 * list would let a change outside the list pass as "unchanged".
 */
export declare const MAX_EXPANDED_ARTIFACTS = 200;
/** Result of reading a declared scope: what was read, and what could not be. */
export interface ArtifactScopeRead {
    artifacts: ArtifactDigest[];
    gaps: ArtifactScopeGap[];
}
/**
 * Read related scopes in one audit. Each scope retains its own expansion cap
 * and gaps, but overlapping paths hash only once. A final revalidation rejects
 * changed file identities and changed directory membership instead of handing
 * out a mixture of revisions as complete evidence.
 */
export declare function readArtifactScopes(workspace: string, scopes: readonly (readonly string[])[]): ArtifactScopeRead[];
/** Read one scope without retaining byte identities for the next request. */
export declare function readArtifactScope(workspace: string, patterns: readonly string[]): ArtifactScopeRead;
/**
 * Read the current bytes of workspace-relative paths (directories expand).
 * Illegal and unreadable paths are reported, never silently dropped.
 */
export declare function digestWorkspacePaths(workspace: string, paths: readonly string[]): ArtifactDigest[];
/**
 * Does this workspace-relative path currently exist as a file or directory?
 * Uses the same containment rules as the digest reader: a symlink that leaves
 * the workspace is not "an existing workspace path".
 */
export declare function workspacePathExists(workspace: string, path: string): boolean;
/** Expand scope patterns to the concrete files they currently cover. */
export declare function expandScopePaths(workspace: string, patterns: readonly string[]): string[];
/**
 * Read one coherent snapshot of the given scope patterns. Directory patterns
 * expand to the files they currently contain; a pattern naming a path that
 * does not exist is recorded as `present: false` so a later creation or
 * deletion is visible as drift, and any incomplete coverage is carried in
 * `gaps`.
 */
export declare function snapshotWorkspacePaths(workspace: string, patterns: readonly string[]): ArtifactSnapshot;
