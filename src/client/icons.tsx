/** Plugin-owned icons avoid depending on the host's generated design-export names. */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
export function IconBranchOutline16() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...stroke}><circle cx="4" cy="3" r="1.5" /><circle cx="12" cy="4" r="1.5" /><circle cx="4" cy="13" r="1.5" /><path d="M4 4.5v7M4 9h3a5 5 0 0 0 5-3.5" /></svg>
}
export function IconChevronDownOutline14() {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" {...stroke}><path d="m3 5 4 4 4-4" /></svg>
}
export function IconPanelLeftOutline16() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...stroke}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6 2.5v11" /></svg>
}
export function IconStopFill16() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" /></svg>
}
export function IconWarningOutline16() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...stroke}><path d="m7 2-5.5 10a1 1 0 0 0 1 1.5h11a1 1 0 0 0 1-1.5L9 2a1.1 1.1 0 0 0-2 0Z" /><path d="M8 6v3m0 2v.1" /></svg>
}

/** Global console entry: three teammates joined around a shared lead. */
export function IconTeamsConsole({ size = 16, active = false }: { readonly size?: number; readonly active?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke} data-active={active || undefined}><circle cx="4.5" cy="4" r="1.5" /><circle cx="11.5" cy="4" r="1.5" /><circle cx="8" cy="11.5" r="1.5" /><path d="M4.5 5.5v1.2A2.3 2.3 0 0 0 6.8 9h.5M11.5 5.5v1.2A2.3 2.3 0 0 1 9.2 9h-.5" /></svg>
}
