/** Read-only project overview for the AgentTeams shell. */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { AgentTeamsTranslate } from './locales.ts'
import css from './ProjectOverviewPanel.module.css'

interface JsonObject {
  readonly [key: string]: unknown
}

interface ProjectRecord {
  readonly workspace: string
  readonly status: JsonObject
  readonly report: JsonObject
  readonly executionLinks: readonly JsonObject[]
}

interface ProjectRouteBody {
  readonly projects?: unknown
}

interface ProjectOverviewPanelProps {
  readonly t: AgentTeamsTranslate
  readonly embedded?: boolean
}

interface ProjectSummary {
  readonly name: string
  readonly phase: string
  readonly requirement: string
  readonly design: string
  readonly counts: Readonly<Record<string, number>>
  readonly risks: number
  readonly decisions: number
  readonly clarifications: number
}

const PROJECT_PANEL_POSITION_KEY = 'dsh-agent-teams.project-overview.position.v1'
const PROJECT_PANEL_VISIBILITY_KEY = 'dsh-agent-teams.project-overview.visibility.v1'
const PROJECT_PANEL_INSET = 12
const PROJECT_PANEL_WIDTH = 430

interface PanelPosition {
  readonly x: number
  readonly y: number
}

function clampPosition(position: PanelPosition): PanelPosition {
  if (typeof window === 'undefined') return position
  const width = Math.min(PROJECT_PANEL_WIDTH, Math.max(0, window.innerWidth - PROJECT_PANEL_INSET * 2))
  return {
    x: Math.min(Math.max(PROJECT_PANEL_INSET, position.x), Math.max(PROJECT_PANEL_INSET, window.innerWidth - width - PROJECT_PANEL_INSET)),
    y: Math.min(Math.max(PROJECT_PANEL_INSET, position.y), Math.max(PROJECT_PANEL_INSET, window.innerHeight - 96)),
  }
}

function readPanelPosition(): PanelPosition {
  const fallback = { x: PROJECT_PANEL_INSET, y: PROJECT_PANEL_INSET }
  if (typeof window === 'undefined') return fallback
  try {
    const value = JSON.parse(window.localStorage.getItem(PROJECT_PANEL_POSITION_KEY) ?? '') as { x?: unknown; y?: unknown }
    if (typeof value.x !== 'number' || !Number.isFinite(value.x) || typeof value.y !== 'number' || !Number.isFinite(value.y)) return fallback
    return clampPosition({ x: value.x, y: value.y })
  } catch {
    return fallback
  }
}

function persistPanelPosition(position: PanelPosition): void {
  try {
    window.localStorage.setItem(PROJECT_PANEL_POSITION_KEY, JSON.stringify(position))
  } catch {}
}

function readPanelVisibility(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(PROJECT_PANEL_VISIBILITY_KEY) !== 'hidden'
  } catch {
    return true
  }
}

function persistPanelVisibility(visible: boolean): void {
  try {
    window.localStorage.setItem(PROJECT_PANEL_VISIBILITY_KEY, visible ? 'visible' : 'hidden')
  } catch {}
}

function displayProjectStatus(value: string): string {
  const labels: Record<string, string> = {
    approved: '已确认',
    accepted: '已验收',
    delivered: '已交付',
    completed: '已完成',
    draft: '草稿',
    pending: '待处理',
    planning: '规划中',
    discovery: '探索中',
    implementing: '实现中',
    verifying: '验证中',
    reviewing: '审查中',
    awaiting_acceptance: '待验收',
    implemented_not_accepted: '已实现，待验收',
    failed_review: '审查失败',
    failed_verification: '验证失败',
    in_progress: '进行中',
    blocked: '受阻',
    not_started: '未开始',
  }
  return labels[value] ?? value
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function at(root: JsonObject, ...path: string[]): unknown {
  let current: unknown = root
  for (const key of path) {
    const object = asObject(current)
    if (object === undefined) return undefined
    current = object[key]
  }
  return current
}

function firstString(root: JsonObject, paths: readonly (readonly string[])[]): string {
  for (const path of paths) {
    const value = asString(at(root, ...path))
    if (value !== undefined) return value
  }
  return '—'
}

function objectArray(value: unknown): readonly JsonObject[] {
  return Array.isArray(value)
    ? value.map(asObject).filter((item): item is JsonObject => item !== undefined)
    : []
}

function firstObjectArray(root: JsonObject, paths: readonly (readonly string[])[]): readonly JsonObject[] {
  for (const path of paths) {
    const value = at(root, ...path)
    if (Array.isArray(value)) return objectArray(value)
  }
  return []
}

function firstArrayLength(root: JsonObject, paths: readonly (readonly string[])[]): number {
  for (const path of paths) {
    const value = at(root, ...path)
    if (Array.isArray(value)) return value.length
  }
  return 0
}

function statusBucketCounts(value: unknown): Readonly<Record<string, number>> {
  const buckets = asObject(value)
  if (buckets === undefined) return {}
  const counts: Record<string, number> = {}
  for (const [status, entries] of Object.entries(buckets)) {
    if (Array.isArray(entries)) counts[status] = entries.length
  }
  return counts
}

function statusLabel(value: unknown): string {
  if (typeof value === 'boolean') return value ? '已确认' : '待确认'
  return displayProjectStatus(asString(value) ?? '未知')
}

function openObjectCount(items: readonly JsonObject[], openStatuses: readonly string[]): number {
  return items.filter((item) => {
    const status = asString(item.status)?.toLowerCase()
    return status === undefined || openStatuses.includes(status)
  }).length
}

function summarize(record: ProjectRecord): ProjectSummary {
  const status = record.status
  const items = firstObjectArray(status, [
    ['workItems'],
    ['work_items'],
    ['project', 'work_items'],
  ])
  const counts: Record<string, number> = {}
  for (const item of items) {
    const itemStatus = asString(item.status) ?? 'unknown'
    counts[itemStatus] = (counts[itemStatus] ?? 0) + 1
  }
  if (items.length === 0) {
    Object.assign(counts, statusBucketCounts(at(record.report, 'work_items_by_status')))
  }
  const decisions = firstObjectArray(status, [['decisions'], ['project', 'decisions'], ['report', 'pending_decisions']])
  const clarifications = firstObjectArray(status, [['clarifications'], ['project', 'clarifications'], ['report', 'open_clarifications']])
  return {
    name: firstString(status, [['title'], ['name'], ['project', 'title'], ['project', 'name']]),
    phase: (counts.implemented_not_accepted ?? 0) > 0 || (counts.awaiting_acceptance ?? 0) > 0
      ? 'awaiting_acceptance'
      : firstString(status, [['phase'], ['lifecycle', 'phase'], ['project', 'phase']]),
    requirement: statusLabel(
      at(status, 'requirement', 'status')
      ?? at(status, 'gates', 'requirement')
      ?? at(status, 'requirementGate'),
    ),
    design: statusLabel(
      at(status, 'design', 'status')
      ?? at(status, 'gates', 'design')
      ?? at(status, 'designGate'),
    ),
    counts,
    risks: firstArrayLength(status, [['risks'], ['project', 'risks'], ['report', 'risks']]),
    decisions: openObjectCount(decisions, ['pending']),
    clarifications: openObjectCount(clarifications, ['open']),
  }
}

function count(summary: ProjectSummary, ...statuses: string[]): number {
  return statuses.reduce((total, status) => total + (summary.counts[status] ?? 0), 0)
}

function executionCount(record: ProjectRecord, status?: string): number {
  if (status === undefined) return record.executionLinks.length
  return record.executionLinks.filter((link) => asString(link.projected_status) === status).length
}

async function loadProjects(signal: AbortSignal): Promise<readonly ProjectRecord[]> {
  const response = await fetch('/plugins/dsh-agent-teams/project', {
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error('project route unavailable')
  const body = await response.json() as ProjectRouteBody
  if (!Array.isArray(body.projects)) return []
  return body.projects
    .map((value) => asObject(value))
    .filter((value): value is JsonObject => value !== undefined)
    .map((value) => ({
      workspace: asString(value.workspace) ?? 'workspace',
      status: asObject(value.status) ?? {},
      report: asObject(value.report) ?? {},
      executionLinks: Array.isArray(value.execution_links)
        ? value.execution_links.map(asObject).filter((item): item is JsonObject => item !== undefined)
        : [],
    }))
}

export function ProjectOverviewPanel({ t, embedded = false }: ProjectOverviewPanelProps): ReactElement | null {
  const [projects, setProjects] = useState<readonly ProjectRecord[]>([])
  const [error, setError] = useState(false)
  const [position, setPosition] = useState<PanelPosition>(readPanelPosition)
  const dragRef = useRef<{ pointerId: number; originX: number; originY: number; startX: number; startY: number } | null>(null)

  useEffect(() => {
    let disposed = false
    let controller: AbortController | undefined
    const refresh = (): void => {
      controller?.abort()
      controller = new AbortController()
      void loadProjects(controller.signal).then((next) => {
        if (disposed) return
        setProjects(next)
        setError(false)
      }).catch((cause: unknown) => {
        if (disposed || (cause as { name?: unknown })?.name === 'AbortError') return
        setError(true)
      })
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => {
      disposed = true
      controller?.abort()
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const onResize = (): void => {
      setPosition((current) => {
        const next = clampPosition(current)
        persistPanelPosition(next)
        return next
      })
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  const startDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      originX: position.x,
      originY: position.y,
      startX: event.clientX,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const next = clampPosition({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    })
    setPosition(next)
    persistPanelPosition(next)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  if (projects.length === 0 && !error) return null
  return (
    <section
      className={embedded ? css.embeddedPanel : css.panel}
      aria-label={t('project.aria')}
      style={embedded ? undefined : { left: position.x, top: position.y }}
      data-dragging={dragRef.current !== null}
    >
      <header
        className={css.header}
        onPointerDown={embedded ? undefined : startDrag}
        onPointerMove={embedded ? undefined : moveDrag}
        onPointerUp={embedded ? undefined : endDrag}
        onPointerCancel={embedded ? undefined : endDrag}
        title={embedded ? undefined : '拖动标题栏移动项目总览'}
      >
        <div>
          <h2 className={css.title}>{t('project.title')}</h2>
        </div>
        <div className={css.headerActions}>
          <span className={css.readOnly}>{t('project.readOnly')}</span>
        </div>
      </header>
      {error && <div className={css.error}>{t('project.refreshError')}</div>}
      {projects.length === 0 && <div className={css.empty}>{t('project.empty')}</div>}
      <div className={css.projects}>
        {projects.map((record) => {
          const summary = summarize(record)
          const active = count(summary, 'in_progress', 'not_started')
          const blocked = count(summary, 'blocked', 'waiting_for_user')
          const review = count(summary, 'failed_review', 'failed_verification')
          const acceptance = count(summary, 'implemented_not_accepted', 'accepted')
          const delivered = count(summary, 'delivered', 'completed')
          return (
            <article className={css.project} key={record.workspace}>
              <div className={css.projectHeading}>
                <div className={css.projectName}>{summary.name === '—' ? record.workspace : summary.name}</div>
                <div className={css.workspace}>{record.workspace}</div>
              </div>
              <div className={css.phase}>{t('project.phase', { phase: displayProjectStatus(summary.phase) })}</div>
              <div className={css.metrics}>
                <span>{t('project.active', { count: active })}</span>
                <span>{t('project.blocked', { count: blocked })}</span>
                <span>{t('project.review', { count: review })}</span>
                <span>{t('project.acceptance', { count: acceptance })}</span>
                <span>{t('project.delivered', { count: delivered })}</span>
              </div>
              <div className={css.gates}>
                <span>{t('project.requirement', { state: summary.requirement })}</span>
                <span>{t('project.design', { state: summary.design })}</span>
              </div>
              <div className={css.attention}>
                <span>{t('project.decisions', { count: summary.decisions })}</span>
                <span>{t('project.clarifications', { count: summary.clarifications })}</span>
                <span>{t('project.risks', { count: summary.risks })}</span>
                <span>{t('project.execution', {
                  count: executionCount(record),
                  active: executionCount(record, 'in_progress'),
                })}</span>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
