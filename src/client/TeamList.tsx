/** Workspace filter and grouped team summaries for the global console. */

import type { ConsoleTeamRow } from './team-console-state.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import css from './TeamConsole.module.css'

/** Display a workspace title without conflating an empty title with "all". */
export function consoleWorkspaceLabel(workspace: string, t: AgentTeamsTranslate): string {
  return workspace.trim() === '' ? t('console.unknownWorkspace') : workspace
}

function teamStatusLabel(row: ConsoleTeamRow, t: AgentTeamsTranslate): string {
  if (row.historic) return t('console.history')
  if (row.team.halted === true) return t('console.halted')
  if (row.team.phase === 'staged') return t('console.planning')
  return t('console.running')
}

function statusTone(row: ConsoleTeamRow): 'history' | 'halted' | 'planning' | 'running' {
  if (row.historic) return 'history'
  if (row.team.halted === true) return 'halted'
  if (row.team.phase === 'staged') return 'planning'
  return 'running'
}

function completedTasks(row: ConsoleTeamRow): number {
  return row.team.tasks.filter((task) => task.status === 'completed').length
}

/** Group rows by workspace while retaining the host's live-then-archive order. */
export function groupConsoleRows(rows: readonly ConsoleTeamRow[]): readonly {
  readonly workspace: string
  readonly rows: readonly ConsoleTeamRow[]
}[] {
  const groups = new Map<string, ConsoleTeamRow[]>()
  for (const row of rows) {
    const group = groups.get(row.team.workspace)
    if (group === undefined) groups.set(row.team.workspace, [row])
    else group.push(row)
  }
  return [...groups].map(([workspace, group]) => ({ workspace, rows: group }))
}

export function WorkspaceFilter({ workspaces, counts, total, value, onChange, t }: {
  readonly workspaces: readonly string[]
  readonly counts: ReadonlyMap<string, number>
  readonly total: number
  readonly value: string | null
  readonly onChange: (workspace: string | null) => void
  readonly t: AgentTeamsTranslate
}) {
  if (workspaces.length <= 1) return null
  return (
    <section className={css.filterSection} aria-label={t('console.workspaces')}>
      <h2>{t('console.workspaces')}</h2>
      <div className={css.filterList} data-console-workspace-filter>
        <button type="button" aria-pressed={value === null} onClick={() => { onChange(null) }}>
          <span>{t('console.allWorkspaces')}</span>
          <span className={css.filterCount}>{total}</span>
        </button>
        {workspaces.map((workspace) => (
          <button
            key={workspace}
            type="button"
            aria-pressed={value === workspace}
            data-workspace={workspace}
            onClick={() => { onChange(workspace) }}
          >
            <span>{consoleWorkspaceLabel(workspace, t)}</span>
            <span className={css.filterCount}>{counts.get(workspace) ?? 0}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function TeamList({ rows, selectedKey, onSelect, t }: {
  readonly rows: readonly ConsoleTeamRow[]
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
  readonly t: AgentTeamsTranslate
}) {
  return (
    <div className={css.teamGroups} data-console-team-list>
      {groupConsoleRows(rows).map((group) => (
        <section key={group.workspace} className={css.teamGroup} data-workspace={group.workspace}>
          <header className={css.teamGroupHead}>
            <h2>{consoleWorkspaceLabel(group.workspace, t)}</h2>
            <span>{t('console.teamCount', { count: group.rows.length })}</span>
          </header>
          <div className={css.teamList}>
            {group.rows.map((row) => {
              const selected = row.key === selectedKey
              const total = row.team.tasks.length
              return (
                <button
                  key={row.key}
                  type="button"
                  className={css.teamRow}
                  aria-pressed={selected}
                  data-console-team-key={row.key}
                  data-console-team-state={statusTone(row)}
                  title={row.team.name}
                  onClick={() => { onSelect(row.key) }}
                >
                  <span className={css.teamRowTop}>
                    <span className={css.teamName}>{row.team.name}</span>
                    <span className={css.teamBadge} data-tone={statusTone(row)}>
                      {teamStatusLabel(row, t)}
                    </span>
                  </span>
                  <span className={css.teamMeta}>
                    <span>{t('console.members', { count: row.team.members.length })}</span>
                    <span>{t('console.progress', { completed: completedTasks(row), total })}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
