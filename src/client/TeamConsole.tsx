/** Global, read-only AgentTeams console registered as a main panel. */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConsoleReturnTargetStore } from './session-navigation.ts'
import type { TeamConsoleStore } from './team-console-state.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import { TeamSection } from './ActivityPanel.tsx'
import { TeamList, WorkspaceFilter, consoleWorkspaceLabel } from './TeamList.tsx'
import { IconPanelLeftOutline16, IconWarningOutline16 } from './icons.tsx'
import { LEAD_ART } from './artwork.ts'
import { startConsolePolling } from './team-console-state.ts'
import css from './TeamConsole.module.css'

/** Sidebar list id and main-panel key; they must stay identical. */
export const CONSOLE_PANEL_ID = 'agent-teams-console'

export interface TeamConsoleInjected {
  readonly state: TeamConsoleStore
  readonly openMember: (parentId: SessionId, childId: SessionId, teamKey: string) => void
  readonly navigation: ConsoleReturnTargetStore
}

export type TeamConsoleProps = PropsRuntime<'main'> & PropsLocale<'agentTeams'> & TeamConsoleInjected

function ConsoleEmpty({ mark, title, body, action }: {
  readonly mark: string
  readonly title: string
  readonly body: string
  readonly action?: { readonly label: string; readonly run: () => void }
}) {
  return (
    <section className={css.empty} data-console-empty>
      <span className={css.emptyMark} aria-hidden>{mark}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action !== undefined && <button type="button" onClick={action.run}>{action.label}</button>}
    </section>
  )
}

function ConsoleLoading({ t }: { readonly t: AgentTeamsTranslate }) {
  return (
    <div className={css.skeleton} role="status" aria-label={t('console.loading')}>
      <i /><i /><i />
    </div>
  )
}

/**
 * The console view. Polling is owned by this mounted panel only: it starts
 * while the main key is selected and the document is visible, and every
 * controller is stopped on cleanup, panel switch, or unmount.
 */
export function TeamConsole({ state, openMember, navigation, usePanelInfo, t }: TeamConsoleProps) {
  const active = usePanelInfo((info) => info.activePanelId === CONSOLE_PANEL_ID)
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot)
  const [retry, setRetry] = useState(0)
  const [pageVisible, setPageVisible] = useState(() => (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  ))

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onChange = (): void => { setPageVisible(document.visibilityState !== 'hidden') }
    document.addEventListener('visibilitychange', onChange)
    return () => { document.removeEventListener('visibilitychange', onChange) }
  }, [])

  useEffect(() => {
    if (!active || !pageVisible) return
    state.begin()
    const controller = startConsolePolling({
      onStatus: (status) => { state.status(status) },
      publish: (update) => { state.apply(update) },
      getRows: state.getRows,
    })
    return () => { controller.stop() }
  }, [active, pageVisible, retry, state])

  // Selecting the console is itself a completed return; do not keep a stale
  // "back" button on an unrelated member transcript later.
  useEffect(() => {
    if (active) navigation.clear()
  }, [active, navigation])

  const counts = new Map<string, number>()
  for (const row of snapshot.rows) {
    counts.set(row.team.workspace, (counts.get(row.team.workspace) ?? 0) + 1)
  }
  const visibleRows = snapshot.workspaceFilter === null
    ? snapshot.rows
    : snapshot.rows.filter((row) => row.team.workspace === snapshot.workspaceFilter)
  const selected = visibleRows.find((row) => row.key === snapshot.selectedKey)
  const statusLabel = snapshot.status === 'loading'
    ? t('console.loading')
    : snapshot.status === 'error'
      ? t('console.offline')
      : t('console.live')

  return (
    <div
      className={css.root}
      data-agent-teams-console
      data-console-status={snapshot.status}
      data-console-active={active || undefined}
    >
      <header className={css.head}>
        <div className={css.heading}>
          <img src={LEAD_ART} alt="" aria-hidden />
          <div>
            <span className={css.eyebrow}>{t('console.eyebrow')}</span>
            <h1>{t('console.title')}</h1>
            <p>{t('console.subtitle')}</p>
          </div>
        </div>
        <span className={css.connection} data-status={snapshot.status}>
          <i aria-hidden />
          {statusLabel}
        </span>
      </header>

      {snapshot.status === 'error' && (
        <div className={css.error} role="alert" data-console-error>
          <IconWarningOutline16 />
          <span>{t('console.error')}</span>
          <button type="button" onClick={() => { setRetry((value) => value + 1) }}>{t('console.retry')}</button>
        </div>
      )}

      <div className={css.body}>
        <aside className={css.rail}>
          <WorkspaceFilter
            workspaces={snapshot.workspaces}
            counts={counts}
            total={snapshot.rows.length}
            value={snapshot.workspaceFilter}
            onChange={(workspace) => { state.setWorkspaceFilter(workspace) }}
            t={t}
          />
          {visibleRows.length > 0 && (
            <TeamList
              rows={visibleRows}
              selectedKey={snapshot.selectedKey}
              onSelect={(key) => { state.selectTeam(key) }}
              t={t}
            />
          )}
        </aside>

        <main className={css.detail}>
          {snapshot.rows.length === 0 && snapshot.status === 'loading' && <ConsoleLoading t={t} />}

          {snapshot.rows.length === 0 && snapshot.status === 'error' && (
            <ConsoleEmpty
              mark="!"
              title={t('console.errorTitle')}
              body={t('console.errorBody')}
              action={{ label: t('console.retry'), run: () => { setRetry((value) => value + 1) } }}
            />
          )}

          {snapshot.rows.length === 0 && snapshot.status === 'ready' && (
            <ConsoleEmpty
              mark="↳"
              title={t('console.emptyTitle')}
              body={t('console.emptyBody')}
            />
          )}

          {snapshot.rows.length > 0 && visibleRows.length === 0 && (
            <ConsoleEmpty
              mark="⌕"
              title={t('console.emptyWorkspaceTitle')}
              body={t('console.emptyWorkspaceBody')}
              action={{ label: t('console.showAll'), run: () => { state.setWorkspaceFilter(null) } }}
            />
          )}

          {selected !== undefined && (
            <section className={css.detailSection} data-console-detail>
              <header className={css.detailHead}>
                <span>{consoleWorkspaceLabel(selected.team.workspace, t)}</span>
                <span>{t('console.readOnly')}</span>
              </header>
              <TeamSection
                key={selected.key}
                team={selected.team}
                workspace
                historic={selected.historic}
                readOnly
                onNavigate={(parentId, childId) => { openMember(parentId, childId, selected.key) }}
                t={t}
              />
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

export interface ConsoleReturnInjected {
  readonly navigation: ConsoleReturnTargetStore
  /** Returns true when the main panel accepted the selection. */
  readonly openConsole: (panelId: string) => boolean
}

/** Header action shown only on the member transcript opened from the console. */
export function ConsoleReturnButton({ sessionId, navigation, openConsole, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'agentTeams'> & ConsoleReturnInjected) {
  const target = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  if (target === undefined || target.memberSessionId !== sessionId) return null
  return (
    <button
      type="button"
      className={css.returnButton}
      data-console-return
      title={t('console.returnHint')}
      onClick={() => {
        if (openConsole(target.panelId)) navigation.clear()
      }}
    >
      <IconPanelLeftOutline16 />
      {t('console.return')}
    </button>
  )
}
