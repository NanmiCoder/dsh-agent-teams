/**
 * Artwork resolution for the team panel: a configured custom directory
 * replaces the packaged whale mascot slug by slug, so a profile can use its
 * own character art without patching the bundle.
 *
 * Two slug families are served:
 *  - the packaged set (role and action art shipped inside the bundle);
 *  - the vendor namespace, `member-<vendor>-<role>`, `member-<vendor>` and
 *    `team-lead-<vendor>`, so the same role can look different depending on
 *    which model vendor a member runs on. Missing combinations degrade along
 *    a fixed chain instead of breaking the image.
 * @module dsh-agent-teams/artwork-source
 */
/** Model vendors that may carry their own character art. */
export declare const ARTWORK_VENDORS: ReadonlyArray<string>;
/** Role buckets the panel assigns artwork to. */
export declare const ARTWORK_ROLES: ReadonlyArray<string>;
/** Artwork that ships inside the bundle; always available as a fallback. */
export declare const PACKAGED_ARTWORK_SLUGS: ReadonlyArray<string>;
/**
 * Media type for a packaged artwork file, derived from its extension.
 *
 * The bundle ships both `.png` artwork and `brand-<vendor>.svg` marks, so the
 * host half must not assume PNG: sending SVG bytes as `image/png` makes the
 * browser fail to decode them, and the badge then degrades to the activity
 * image on `onError` — which looks exactly like "the SVG was never packaged"
 * (that is what shipped in 0.3.1).
 * @param slug - packaged artwork file name, for example `brand-qwen.svg`.
 * @returns the media type for that extension, or `application/octet-stream`.
 */
export declare function packagedArtworkContentType(slug: string): string;
/** One artwork file on disk that answers a requested slug; packaged or custom. */
export interface ArtworkFile {
    /** Absolute path the bytes were read from; reported in diagnostics. */
    path: string;
    /** Media type derived from the file extension. */
    contentType: string;
    /** File bytes. */
    data: Buffer;
}
/** Historical name of {@link ArtworkFile}, kept for the custom-directory call sites. */
export type CustomArtwork = ArtworkFile;
/**
 * Ordered lookup chain for one requested slug, most specific first:
 * `vendor+role` → `role` → `vendor` → `team-lead`. A `-full` request also
 * lists its non-full sibling, so a missing large preview degrades to the
 * avatar art instead of an empty frame.
 * @param slug - requested artwork slug, for example `member-deepseek-qa-v2.png`.
 * @returns slugs to try, most preferred first; empty when the slug is foreign.
 */
export declare function artworkCandidates(slug: string): ReadonlyArray<string>;
/**
 * Whether the asset route may serve this slug. Nothing outside the packaged
 * set and the vendor namespace reaches the filesystem, which also keeps `..`
 * segments and absolute paths out.
 * @param slug - requested artwork slug.
 */
export declare function isAllowedArtwork(slug: string): boolean;
/**
 * File stems that answer one requested slug: the exact stem, then the same
 * stem without the `-v2` release suffix (so `member-qa.png` also answers
 * `member-qa-v2.png`).
 * @param slug - requested artwork slug, for example `member-qa-v2.png`.
 * @returns stems to probe, most specific first.
 */
export declare function artworkStems(slug: string): ReadonlyArray<string>;
/**
 * Resolve one requested slug inside a custom artwork directory.
 * @param dir - absolute custom artwork directory.
 * @param slug - requested artwork slug; rejected unless the panel knows it.
 * @returns the first matching file, or `undefined` to fall back to packaged art.
 */
export declare function findCustomArtwork(dir: string, slug: string): Promise<CustomArtwork | undefined>;
/** File names to probe for one packaged candidate, most preferred first. */
export declare function packagedArtworkNames(candidate: string): ReadonlyArray<string>;
/**
 * Resolve one requested slug inside the packaged artwork directory.
 * @param dir - absolute packaged artwork directory.
 * @param slug - one candidate produced by {@link artworkCandidates}.
 * @returns the first matching file with the media type of the file that matched.
 */
export declare function findPackagedArtwork(dir: string, slug: string): Promise<ArtworkFile | undefined>;
