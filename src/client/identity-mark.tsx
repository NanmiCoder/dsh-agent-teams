/**
 * Identity marks for the activity panel and conversation card.
 *
 * The captain reuses the host companion's echo-whale silhouette (the sidebar
 * 小精灵) so the lead row matches Harness instead of the packaged cartoon
 * cutouts. Members get an original family of geometric marks keyed by name,
 * so two testers never share one face.
 * @module dsh-agent-teams/client/identity-mark
 */

import css from './IdentityMark.module.css'

/** Same silhouette the host sprite paints at 20–72px. */
const ECHO_WHALE_PATH = 'M6.8 35.2C6.8 24.8 15.6 18.2 29.3 17.7C40.4 17.3 48.6 21.6 52.5 28.8C55.2 28.5 58.6 25.4 60.9 21.3C61.4 27.4 59.2 32.4 55.1 35.1C58.1 37.9 59.7 42.1 59.1 46.4C56.8 43 54.3 40.5 51.7 39.5C47.3 47 39.2 51.1 29.3 50.9C15.6 50.6 6.8 44.7 6.8 35.2Z'

const MEMBER_TONES = [
  'var(--dsw-alias-state-business-primary, #4176e6)',
  'var(--dsw-alias-state-success-primary, #12a150)',
  'var(--dsw-alias-label-secondary)',
  'var(--dsw-alias-state-warn-primary, #e08700)',
  'var(--dsw-alias-label-primary)',
  'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 72%, #7c5cbf)',
  'color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 55%, #0f766e)',
  'color-mix(in srgb, var(--dsw-alias-label-primary) 70%, var(--dsw-alias-state-business-primary, #4176e6))',
] as const

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function memberKind(name: string, role: string): number {
  return stableHash(name.trim().toLowerCase() || role.trim().toLowerCase()) % 8
}

function memberTone(name: string, role: string): string {
  return MEMBER_TONES[stableHash(`${name}\0${role}`.toLowerCase()) % MEMBER_TONES.length] ?? MEMBER_TONES[0]
}

function MemberGlyph({ kind }: { readonly kind: number }) {
  switch (kind) {
    case 1:
      return <path d="M12 4.2 19.6 18.6H4.4Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    case 2:
      return (
        <>
          <circle cx="9.4" cy="12" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="14.6" cy="12" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )
    case 3:
      return (
        <>
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="3.1" fill="currentColor" />
        </>
      )
    case 4:
      return <path d="M12 4.6 18.4 7.4v6.1c0 3.6-2.6 5.9-6.4 7.3C8.2 19.4 5.6 17.1 5.6 13.5V7.4Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    case 5:
      return (
        <>
          <rect x="5.2" y="10.2" width="3.2" height="8.2" rx="1.2" fill="currentColor" />
          <rect x="10.4" y="5.6" width="3.2" height="12.8" rx="1.2" fill="currentColor" />
          <rect x="15.6" y="8.2" width="3.2" height="10.2" rx="1.2" fill="currentColor" />
        </>
      )
    case 6:
      return <path d="M12 3.8 19.1 8v8L12 20.2 4.9 16V8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    case 7:
      return (
        <>
          <path d="M7.2 8.1 16.6 9.4 12 17.2Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
          <circle cx="7.2" cy="8.1" r="1.55" fill="currentColor" />
          <circle cx="16.6" cy="9.4" r="1.55" fill="currentColor" />
          <circle cx="12" cy="17.2" r="1.55" fill="currentColor" />
        </>
      )
    default:
      return (
        <>
          <circle cx="12" cy="12" r="7.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="2.7" fill="currentColor" />
        </>
      )
  }
}

/** Host-sprite whale used for the captain row. */
export function CaptainMark({ size = 28 }: { readonly size?: number }) {
  return (
    <svg
      className={`${css.mark} ${css.captain}`}
      width={size}
      height={size}
      viewBox="6 16 54 38"
      fill="none"
      aria-hidden
      data-sprite-render="echo-whale-v2"
    >
      <path d={ECHO_WHALE_PATH} fill="currentColor" />
      <circle className={css.captainEye} cx="20.8" cy="30.3" r="1.45" />
      <circle className={css.captainAccent} cx="34.2" cy="41.5" r="1.2" />
    </svg>
  )
}

/** Geometric member mark; identical roles still diverge by name. */
export function MemberMark({ name, role, size = 26 }: {
  readonly name: string
  readonly role: string
  readonly size?: number
}) {
  return (
    <svg
      className={`${css.mark} ${css.member}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ color: memberTone(name, role) }}
    >
      <MemberGlyph kind={memberKind(name, role)} />
    </svg>
  )
}
