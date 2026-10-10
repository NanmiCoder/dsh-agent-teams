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

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Model vendors that may carry their own character art. */
export const ARTWORK_VENDORS: ReadonlyArray<string> = [
  'deepseek', 'qwen', 'glm', 'kimi',
  'claude', 'gemini', 'grok', 'gpt',
  'hunyuan',
  // 2026-10-08: the second artwork round widened the vendor namespace from 9 to 15.
  // The first ten ship vendor × role art; the last five ship only the vendor-level
  // avatar and portrait, so a role request degrades to the vendor level instead of 404ing.
  'minimax', 'meta', 'mistral', 'rwkv', 'seed', 'ernie',
]

/** Role buckets the panel assigns artwork to. */
export const ARTWORK_ROLES: ReadonlyArray<string> = [
  'engineer', 'qa', 'security', 'researcher',
  'designer', 'docs', 'data', 'operator',
  // Registered 2026-10-05 and drawn 2026-10-08: audio / video have role art for ten
  // vendors; the remaining five degrade to their vendor-level avatar.
  'audio', 'video',
]

/** Artwork that ships inside the bundle; always available as a fallback. */
export const PACKAGED_ARTWORK_SLUGS: ReadonlyArray<string> = [
  'team-lead-v2.png',
  'member-researcher-v2.png', 'member-engineer-v2.png',
  'member-qa-v2.png', 'member-designer-v2.png',
  'member-security-v2.png', 'member-docs-v2.png',
  'member-data-v2.png', 'member-operator-v2.png',
  'action-working-v2.png', 'action-thinking-v2.png',
  'action-reporting-v2.png', 'action-celebrating-v2.png',
  'action-sleeping-v2.png', 'action-sending-v2.png',
]

/** Accepted custom image extensions and their media types, most preferred first. */
const CUSTOM_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
]

/** Decorative stem suffixes, stripped in any order. */
const STEM_SUFFIXES: ReadonlyArray<string> = ['-v2', '-full']

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
export function packagedArtworkContentType(slug: string): string {
  for (const [extension, contentType] of CUSTOM_EXTENSIONS) {
    if (slug.endsWith(extension)) return contentType
  }
  return 'application/octet-stream'
}

/** One artwork file on disk that answers a requested slug; packaged or custom. */
export interface ArtworkFile {
  /** Absolute path the bytes were read from; reported in diagnostics. */
  path: string
  /** Media type derived from the file extension. */
  contentType: string
  /** File bytes. */
  data: Buffer
}

/** Historical name of {@link ArtworkFile}, kept for the custom-directory call sites. */
export type CustomArtwork = ArtworkFile

/** Strip the decorative suffixes from a stem. */
function coreStem(stem: string): string {
  let core = stem
  for (let pass = 0; pass < STEM_SUFFIXES.length; pass++) {
    for (const suffix of STEM_SUFFIXES) {
      if (core.endsWith(suffix)) core = core.slice(0, -suffix.length)
    }
  }
  return core
}

/** Whether the stem asks for the large-preview variant. */
function wantsFull(stem: string): boolean {
  return stem.split('-').includes('full')
}

/** Split a `member-…` core into its vendor and role, either of which may be absent. */
function memberParts(core: string): { vendor: string | undefined; role: string | undefined } {
  const parts = core.slice('member-'.length).split('-')
  return {
    vendor: parts.find((part) => ARTWORK_VENDORS.includes(part)),
    role: parts.find((part) => ARTWORK_ROLES.includes(part)),
  }
}

/**
 * Ordered lookup chain for one requested slug, most specific first:
 * `vendor+role` → `role` → `vendor` → `team-lead`. A `-full` request also
 * lists its non-full sibling, so a missing large preview degrades to the
 * avatar art instead of an empty frame.
 * @param slug - requested artwork slug, for example `member-deepseek-qa-v2.png`.
 * @returns slugs to try, most preferred first; empty when the slug is foreign.
 */
export function artworkCandidates(slug: string): ReadonlyArray<string> {
  if (PACKAGED_ARTWORK_SLUGS.includes(slug)) return [slug]
  const stem = slug.replace(/\.[^.]+$/u, '')
  // Vendor brand marks are an independent family served for the state badge:
  // `brand-<vendor>.svg` first, then a `.png` sibling of the same name, then
  // the family default. A brand mark has no role to degrade to, so the client
  // keeps the activity art when its request fails.
  if (stem.startsWith('brand-')) {
    const vendor = stem.slice('brand-'.length)
    return ARTWORK_VENDORS.includes(vendor)
      ? [`brand-${vendor}.svg`, `brand-${vendor}.png`, 'brand.svg', 'brand.png']
      : []
  }
  // The panel only ever requests `.png` slugs; the file on disk may use any
  // accepted extension, but the requested name itself stays strict.
  if (!slug.endsWith('.png')) return []
  const core = coreStem(stem)
  const full = wantsFull(stem)
  const out: string[] = []
  const push = (base: string): void => {
    const names = full ? [`${base}-full-v2.png`, `${base}-v2.png`] : [`${base}-v2.png`]
    for (const name of names) if (!out.includes(name)) out.push(name)
  }
  if (core === 'team-lead') push('team-lead')
  else if (core.startsWith('team-lead-')) {
    const vendor = core.slice('team-lead-'.length)
    if (ARTWORK_VENDORS.includes(vendor)) {
      push(`team-lead-${vendor}`)
      push('team-lead')
    }
  } else if (core.startsWith('member-')) {
    const { vendor, role } = memberParts(core)
    if (vendor !== undefined && role !== undefined) {
      push(`member-${vendor}-${role}`)
      push(`member-${role}`)
      push(`member-${vendor}`)
    } else if (role !== undefined) push(`member-${role}`)
    else if (vendor !== undefined) push(`member-${vendor}`)
  }
  return out
}

/**
 * Whether the asset route may serve this slug. Nothing outside the packaged
 * set and the vendor namespace reaches the filesystem, which also keeps `..`
 * segments and absolute paths out.
 * @param slug - requested artwork slug.
 */
export function isAllowedArtwork(slug: string): boolean {
  return artworkCandidates(slug).length > 0
}

/**
 * File stems that answer one requested slug: the exact stem, then the same
 * stem without the `-v2` release suffix (so `member-qa.png` also answers
 * `member-qa-v2.png`).
 * @param slug - requested artwork slug, for example `member-qa-v2.png`.
 * @returns stems to probe, most specific first.
 */
export function artworkStems(slug: string): ReadonlyArray<string> {
  const stem = slug.replace(/\.[^.]+$/u, '')
  const legacy = stem.replace(/-v2$/u, '')
  return legacy === stem ? [stem] : [stem, legacy]
}

/**
 * Resolve one requested slug inside a custom artwork directory.
 * @param dir - absolute custom artwork directory.
 * @param slug - requested artwork slug; rejected unless the panel knows it.
 * @returns the first matching file, or `undefined` to fall back to packaged art.
 */
export async function findCustomArtwork(dir: string, slug: string): Promise<CustomArtwork | undefined> {
  if (!isAllowedArtwork(slug)) return undefined
  for (const stem of artworkStems(slug)) {
    for (const [extension, contentType] of CUSTOM_EXTENSIONS) {
      const path = join(dir, `${stem}${extension}`)
      try {
        return { path, contentType, data: await readFile(path) }
      } catch {
        // Missing, unreadable, or a directory: try the next candidate name.
      }
    }
  }
  return undefined
}

/**
 * Slug families the bundle may ship under an extension other than `.png`.
 *
 * The panel always requests `member-…-v2.png` / `team-lead-…-v2.png`, but the
 * `-full` preview family ships as WebP: at preview resolution a lossless PNG is
 * several megabytes per image, while a quality-92 WebP is a tenth of that, and
 * the browser decodes both through the same `<img>` slot. Probing the accepted
 * extensions for one stem — most preferred first — is exactly what the custom
 * directory already does, so the bundle stays consistent with it. Brand marks
 * keep the strict candidate name: their family already lists `.svg` before
 * `.png`, and rewriting that order would change which mark wins.
 */
const PROBED_PACKAGED_STEM = /^(?:member-|team-lead)/u

/** File names to probe for one packaged candidate, most preferred first. */
export function packagedArtworkNames(candidate: string): ReadonlyArray<string> {
  const stem = candidate.replace(/\.[^.]+$/u, '')
  if (!candidate.endsWith('.png') || !PROBED_PACKAGED_STEM.test(stem)) return [candidate]
  return CUSTOM_EXTENSIONS.map(([extension]) => `${stem}${extension}`)
}

/**
 * Resolve one requested slug inside the packaged artwork directory.
 * @param dir - absolute packaged artwork directory.
 * @param slug - one candidate produced by {@link artworkCandidates}.
 * @returns the first matching file with the media type of the file that matched.
 */
export async function findPackagedArtwork(dir: string, slug: string): Promise<ArtworkFile | undefined> {
  for (const name of packagedArtworkNames(slug)) {
    const path = join(dir, name)
    try {
      return { path, contentType: packagedArtworkContentType(name), data: await readFile(path) }
    } catch {
      // Not shipped under this extension: try the next one.
    }
  }
  return undefined
}