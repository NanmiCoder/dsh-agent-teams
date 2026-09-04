/** Pure persisted geometry rules for the AgentTeams shell-overlay panel. */

export type PanelMode = 'docked' | 'floating'
export type PanelHeightMode = 'auto' | 'manual'
export type PanelResizeEdge = 'left' | 'bottom' | 'corner'

/** User-owned panel state persisted between browser sessions. */
export interface PanelLayout {
  readonly mode: PanelMode
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly heightMode: PanelHeightMode
}

/**
 * The shell-overlay box and the right edge of its current conversation.
 *
 * Every horizontal/vertical value in this module is local to the shell
 * overlay: (0, 0) is the overlay's top-left corner, never the browser
 * viewport. The host may omit anchorRight while the overlay is being
 * measured; in that case the overlay's own right edge is the safe anchor.
 */
export interface PanelBounds {
  readonly width: number
  readonly height: number
  readonly anchorRight?: number
}

export const PANEL_LAYOUT_STORAGE_KEY = 'dsh-agent-teams:activity-panel:v1'
export const PANEL_COMPACT_BREAKPOINT = 960
export const PANEL_DEFAULT_WIDTH = 388
export const PANEL_DEFAULT_HEIGHT = 640
export const PANEL_MIN_WIDTH = 320
export const PANEL_MAX_WIDTH = 640
export const PANEL_MIN_HEIGHT = 360
// Docked mode is the third shell column. Keep a stable shell gutter so the
// conversation and the AgentTeams column remain visibly separate siblings.
export const PANEL_DOCK_TOP = 64
export const PANEL_DOCK_RIGHT = 18
export const PANEL_DOCK_BOTTOM = 48
export const PANEL_FLOAT_MARGIN = 12

export const DEFAULT_PANEL_LAYOUT: PanelLayout = Object.freeze({
  mode: 'docked',
  x: 0,
  y: PANEL_DOCK_TOP,
  width: PANEL_DEFAULT_WIDTH,
  height: PANEL_DEFAULT_HEIGHT,
  heightMode: 'auto',
})

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Normalize host measurements before applying local geometry rules.
 *
 * Harness can render an additive slot for one frame before its final box is
 * available. Keeping all downstream math finite prevents a transient
 * missing/invalid anchor from producing NaN CSS coordinates (which browsers
 * commonly resolve as the top-left corner). The fallback anchor is explicitly
 * the shell's right edge, still in shell-local coordinates.
 */
function normalizeBounds(bounds: PanelBounds): Required<PanelBounds> {
  const width = finite(bounds.width) ? Math.max(1, bounds.width) : 1
  const height = finite(bounds.height) ? Math.max(1, bounds.height) : 1
  const anchorRight = finite(bounds.anchorRight)
    ? clamp(bounds.anchorRight, 0, width)
    : width
  return { width, height, anchorRight }
}

/** Decode one versioned localStorage value, rejecting partial/corrupt state. */
export function parsePanelLayout(value: string | null): PanelLayout {
  if (value === null) return DEFAULT_PANEL_LAYOUT
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PANEL_LAYOUT
    const record = parsed as Record<string, unknown>
    if ((record.mode !== 'docked' && record.mode !== 'floating')
      || !finite(record.x) || !finite(record.y)
      || !finite(record.width) || !finite(record.height)) {
      return DEFAULT_PANEL_LAYOUT
    }
    return {
      mode: record.mode,
      x: record.x,
      y: record.y,
      width: record.width,
      height: record.height,
      // v1 values written before content-fit height existed have no mode.
      // Treat them as automatic so the upgrade removes legacy blank space.
      // Docked panels are a shell column and always content-fit. Older
      // persisted docked values may contain a manual height from the former
      // floating implementation; migrate those values to auto on restore.
      heightMode: record.mode === 'floating' && record.heightMode === 'manual' ? 'manual' : 'auto',
    }
  } catch {
    return DEFAULT_PANEL_LAYOUT
  }
}

/** Whether the panel should become a simple inset overlay with no gestures. */
export function compactPanelForBounds(bounds: PanelBounds): boolean {
  return normalizeBounds(bounds).width <= PANEL_COMPACT_BREAKPOINT
}

/** Docked and compact panels always fit content; floating panels may be user-sized. */
export function panelUsesAutoHeight(layout: PanelLayout, bounds: PanelBounds): boolean {
  return compactPanelForBounds(bounds) || layout.heightMode === 'auto'
}

/** CSS max-height ceiling that keeps an auto-height panel inside its shell. */
export function panelMaximumHeight(layout: PanelLayout, bounds: PanelBounds): number {
  const normalized = normalizeBounds(bounds)
  const bottomInset = compactPanelForBounds(bounds) || layout.mode === 'floating'
    ? PANEL_FLOAT_MARGIN
    : PANEL_DOCK_BOTTOM
  return Math.max(1, normalized.height - layout.y - bottomInset)
}

/** Resolve persisted state into a visible rectangle inside the current shell. */
export function resolvePanelGeometry(layout: PanelLayout, bounds: PanelBounds): PanelLayout {
  const normalized = normalizeBounds(bounds)
  const boundsWidth = normalized.width
  const boundsHeight = normalized.height

  if (compactPanelForBounds(bounds)) {
    return {
      ...layout,
      x: PANEL_FLOAT_MARGIN,
      y: PANEL_FLOAT_MARGIN,
      width: Math.max(1, boundsWidth - PANEL_FLOAT_MARGIN * 2),
      height: Math.max(1, boundsHeight - PANEL_FLOAT_MARGIN * 2),
    }
  }

  const maximumWidth = Math.max(1, Math.min(PANEL_MAX_WIDTH, boundsWidth - PANEL_FLOAT_MARGIN * 2))
  const minimumWidth = Math.min(PANEL_MIN_WIDTH, maximumWidth)
  const width = clamp(layout.width, minimumWidth, maximumWidth)
  const maximumHeight = Math.max(1, boundsHeight - PANEL_FLOAT_MARGIN * 2)
  const minimumHeight = Math.min(PANEL_MIN_HEIGHT, maximumHeight)

  if (layout.mode === 'docked') {
    // A docked panel is a real third shell column. Do not inherit the
    // floating panel's 12px inset; that inset is the visible top gap.
    const y = clamp(PANEL_DOCK_TOP, 0, Math.max(0, boundsHeight - minimumHeight))
    const availableHeight = Math.max(1, boundsHeight - y - PANEL_DOCK_BOTTOM)
    const height = layout.heightMode === 'manual'
      ? clamp(layout.height, Math.min(minimumHeight, availableHeight), availableHeight)
      : availableHeight
    const maximumX = Math.max(0, normalized.anchorRight - PANEL_DOCK_RIGHT - width)
    const x = clamp(normalized.anchorRight - PANEL_DOCK_RIGHT - width, 0, maximumX)
    return { mode: 'docked', x, y, width, height, heightMode: layout.heightMode }
  }

  const height = clamp(layout.height, minimumHeight, maximumHeight)
  return {
    mode: 'floating',
    x: clamp(layout.x, PANEL_FLOAT_MARGIN, Math.max(PANEL_FLOAT_MARGIN, boundsWidth - width - PANEL_FLOAT_MARGIN)),
    y: clamp(layout.y, PANEL_FLOAT_MARGIN, Math.max(PANEL_FLOAT_MARGIN, boundsHeight - height - PANEL_FLOAT_MARGIN)),
    width,
    height,
    heightMode: layout.heightMode,
  }
}

/** Undock without a visual jump by adopting the panel's resolved rectangle. */
export function floatPanelLayout(geometry: PanelLayout, bounds: PanelBounds): PanelLayout {
  return resolvePanelGeometry({ ...geometry, mode: 'floating' }, bounds)
}

/** Return to the right dock, preserving width and restoring content-fit height. */
export function dockPanelLayout(layout: PanelLayout, bounds: PanelBounds): PanelLayout {
  return resolvePanelGeometry({ ...layout, mode: 'docked', heightMode: 'auto' }, bounds)
}

/** Translate a floating panel and clamp it back into the visible shell. */
export function movePanelLayout(
  start: PanelLayout,
  dx: number,
  dy: number,
  bounds: PanelBounds,
): PanelLayout {
  return resolvePanelGeometry({ ...start, mode: 'floating', x: start.x + dx, y: start.y + dy }, bounds)
}

/** Resize while keeping the edge opposite the active handle stationary. */
export function resizePanelLayout(
  start: PanelLayout,
  edge: PanelResizeEdge,
  dx: number,
  dy: number,
  bounds: PanelBounds,
): PanelLayout {
  if (start.mode === 'docked') {
    if (edge !== 'left') return resolvePanelGeometry(start, bounds)
    return resolvePanelGeometry({ ...start, width: start.width - dx }, bounds)
  }

  const resolved = resolvePanelGeometry(start, bounds)
  const minimumWidth = Math.min(PANEL_MIN_WIDTH, resolved.x + resolved.width - PANEL_FLOAT_MARGIN)
  const minimumHeight = Math.min(PANEL_MIN_HEIGHT, bounds.height - resolved.y - PANEL_FLOAT_MARGIN)

  if (edge === 'left') {
    const right = resolved.x + resolved.width
    const maximumWidth = Math.max(1, Math.min(PANEL_MAX_WIDTH, right - PANEL_FLOAT_MARGIN))
    const width = clamp(resolved.width - dx, Math.min(minimumWidth, maximumWidth), maximumWidth)
    return { ...resolved, x: right - width, width }
  }

  const maximumHeight = Math.max(1, bounds.height - resolved.y - PANEL_FLOAT_MARGIN)
  const height = clamp(resolved.height + dy, Math.min(minimumHeight, maximumHeight), maximumHeight)
  if (edge === 'bottom') return { ...resolved, height, heightMode: 'manual' }

  const maximumWidth = Math.max(1, Math.min(
    PANEL_MAX_WIDTH,
    bounds.width - resolved.x - PANEL_FLOAT_MARGIN,
  ))
  const width = clamp(resolved.width + dx, Math.min(minimumWidth, maximumWidth), maximumWidth)
  return { ...resolved, width, height, heightMode: 'manual' }
}
