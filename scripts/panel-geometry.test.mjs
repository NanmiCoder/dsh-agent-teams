import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_FLOAT_MARGIN,
  PANEL_MIN_WIDTH,
  dockPanelLayout,
  floatPanelLayout,
  movePanelLayout,
  resolvePanelGeometry,
  resizePanelLayout,
} from '../lib/client/panel-geometry.js'

const wideShell = { width: 1440, height: 900, anchorRight: 1440 }

test('keeps docked and floating geometry local to the shell overlay', () => {
  const docked = resolvePanelGeometry(DEFAULT_PANEL_LAYOUT, wideShell)
  assert.equal(docked.x, 1034)
  assert.equal(docked.y, 64)

  const floating = floatPanelLayout(docked, wideShell)
  assert.equal(floating.x, docked.x)
  assert.equal(floating.y, docked.y)

  const moved = movePanelLayout(floating, -2000, -2000, wideShell)
  assert.equal(moved.x, PANEL_FLOAT_MARGIN)
  assert.equal(moved.y, PANEL_FLOAT_MARGIN)
})

test('uses a conversation anchor measured from the overlay left edge', () => {
  const bounds = { width: 1440, height: 900, anchorRight: 1080 }
  const docked = resolvePanelGeometry(DEFAULT_PANEL_LAYOUT, bounds)

  assert.equal(docked.x, 674)
  assert.ok(docked.x >= PANEL_FLOAT_MARGIN)
  assert.ok(docked.x + docked.width <= bounds.width - PANEL_FLOAT_MARGIN)
})

test('falls back to the shell right edge when the first measurement has no anchor', () => {
  const missingAnchor = resolvePanelGeometry(DEFAULT_PANEL_LAYOUT, {
    width: 1440,
    height: 900,
  })
  const invalidAnchor = resolvePanelGeometry(DEFAULT_PANEL_LAYOUT, {
    width: 1440,
    height: 900,
    anchorRight: Number.NaN,
  })

  assert.equal(missingAnchor.x, 1034)
  assert.equal(invalidAnchor.x, 1034)
  assert.ok(Number.isFinite(missingAnchor.x))
  assert.ok(Number.isFinite(missingAnchor.y))
})

test('keeps resize and window-size changes inside the same local coordinate space', () => {
  const start = resolvePanelGeometry({
    ...DEFAULT_PANEL_LAYOUT,
    mode: 'floating',
    x: 400,
    y: 200,
    height: 500,
    heightMode: 'manual',
  }, wideShell)
  const resized = resizePanelLayout(start, 'corner', 1200, 1200, wideShell)
  assert.equal(resized.x, 400)
  assert.equal(resized.y, 200)
  assert.equal(resized.width, 640)
  assert.equal(resized.height, 688)

  const smallerShell = { width: 820, height: 620, anchorRight: 820 }
  const clamped = resolvePanelGeometry(resized, smallerShell)
  assert.ok(clamped.x >= PANEL_FLOAT_MARGIN)
  assert.ok(clamped.y >= PANEL_FLOAT_MARGIN)
  assert.ok(clamped.x + clamped.width <= smallerShell.width - PANEL_FLOAT_MARGIN)
  assert.ok(clamped.y + clamped.height <= smallerShell.height - PANEL_FLOAT_MARGIN)
  assert.ok(clamped.width >= Math.min(PANEL_MIN_WIDTH, smallerShell.width - PANEL_FLOAT_MARGIN * 2))
})

test('dock toggle preserves the local rectangle contract', () => {
  const docked = resolvePanelGeometry(DEFAULT_PANEL_LAYOUT, wideShell)
  const floating = movePanelLayout(floatPanelLayout(docked, wideShell), -250, 80, wideShell)
  const redocked = dockPanelLayout({ ...floating, width: 472, heightMode: 'manual' }, wideShell)

  assert.equal(redocked.x, 950)
  assert.equal(redocked.y, 64)
  assert.equal(redocked.width, 472)
  assert.equal(redocked.heightMode, 'auto')
})
