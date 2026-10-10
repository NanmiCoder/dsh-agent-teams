/**
 * Shared character artwork lookup for the activity panel and the conversation
 * card: role keywords pick the role, and a member's model vendor picks which
 * character wears it. The captain always uses the lead artwork.
 *
 * Only the most specific slug is requested here. The host degrades a missing
 * combination along `vendor+role → role → vendor → packaged whale`, so a
 * vendor this list does not know still gets the role artwork instead of a
 * broken image.
 * @module dsh-agent-teams/client/artwork
 */
/** Artwork route prefix served by the plugin host half. */
export declare const ART_BASE = "/plugins/dsh-agent-teams/assets/";
/** Chinese label map for role tokens.
 * Used by tests and as a reference lookup; the UI itself uses `labelKey` + `t()` for i18n.
 */
export declare const ROLE_LABELS: Readonly<Record<string, string>>;
type AgentTeamsLocaleKey = import('./locales.ts').AgentTeamsLocaleKey;
/** Resolved artwork for one member. */
export interface ResolvedMemberArtwork {
    /** Avatar URL, or null when neither role nor vendor is known. */
    url: string | null;
    /** Large preview URL, or null when neither role nor vendor is known. */
    full: string | null;
    /** Matched role token, or null when no role matched. */
    role: string | null;
    /** Locale key for the role's Chinese label, or null when no role matched. */
    labelKey: AgentTeamsLocaleKey | null;
    /** True when the image is the vendor-generic fallback because no role matched. */
    isFallback: boolean;
}
/**
 * Captain artwork. The vendor-specific name is requested first, and a custom
 * `team-lead-v2.png` still answers it through the host's degradation chain, so
 * the captain can be themed per vendor while one plain override keeps working.
 *
 * It deliberately avoids the packaged slug: that URL existed before any custom
 * directory did and had been served with a 24h cache, so a browser that already
 * held it kept replaying the packaged whale instead of asking for the override.
 * A name the browser has never seen cannot be shadowed by stale bytes.
 */
export declare const LEAD_ART = "/plugins/dsh-agent-teams/assets/team-lead-deepseek-v2.png";
/** Large-preview artwork for the captain; degrades to {@link LEAD_ART}. */
export declare const LEAD_FULL_ART = "/plugins/dsh-agent-teams/assets/team-lead-deepseek-full-v2.png";
/** Status action artwork per member activity. */
export declare const ACTION_ART: Record<'working' | 'idle' | 'unknown', string>;
/**
 * Vendor token behind a member's model route, when this build knows it.
 * @param member - a snapshot member carrying its `provider`/`model` route.
 * @returns the vendor token, or undefined to keep the role artwork.
 */
export declare function vendorSlug(member: {
    readonly provider?: string;
    readonly model?: string;
} | undefined): string | undefined;
/**
 * Role token for a member identity, or null when no role matches.
 * @param name - the member's display name.
 * @param role - the member's role text.
 */
export declare function memberRoleSlug(name: string, role: string): string | null;
/**
 * Unified artwork resolver. Implements the client-side degradation chain:
 * role+vendor → role → vendor → initial-letter fallback.
 *
 * - If a role matches, request `member-<vendor>-<role>-v2.png` (or the generic
 *   role image when the vendor is unknown).
 * - If no role matches but the vendor is known, request the vendor-generic
 *   `member-<vendor>-v2.png` and mark it as a fallback.
 * - If neither role nor vendor is known, return null so the caller can fall back
 *   to the initial-letter badge.
 * @param options - member display name, role text, and optional vendor token.
 */
export declare function resolveMemberArtwork({ name: _name, role, vendor, }: {
    name: string;
    role: string;
    vendor?: string;
}): ResolvedMemberArtwork;
/** Format the caption under the enlarged member/leader artwork preview. */
export declare function formatArtPreviewCaption({ name, labelKey, kind, t, }: {
    name: string;
    labelKey: AgentTeamsLocaleKey | null;
    kind: 'captain' | 'member';
    t: import('./locales.ts').AgentTeamsTranslate;
}): string;
/**
 * Member artwork URL, or null when no role matches (initial-letter fallback).
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @param vendor - optional vendor token from {@link vendorSlug}.
 * @returns the artwork URL, or null when unmatched.
 */
export declare function memberArtUrl(name: string, role: string, vendor?: string): string | null;
/**
 * Vendor brand mark URL for the state badge, or null when the vendor is
 * unknown (the badge then keeps the packaged activity art). A missing file is
 * not fatal: the caller falls back on the image's error event.
 * @param vendor - vendor token from {@link vendorSlug}.
 */
export declare function brandArtUrl(vendor: string | undefined): string | null;
/**
 * Large-preview artwork URL for the same member. Safe to request even when no
 * `-full` file exists: the host degrades to the avatar art.
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @param vendor - optional vendor token from {@link vendorSlug}.
 * @returns the large-preview URL, or null when no role matched.
 */
export declare function memberFullArtUrl(name: string, role: string, vendor?: string): string | null;
export {};
