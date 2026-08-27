/**
 * Editable pre-run roster and DAG review for staged AgentTeams plans.
 *
 * This leaf owns only transient form/disclosure state. Durable truth remains
 * on the host and returns through the ordinary activity polling snapshot.
 * @module dsh-agent-teams/client/staging-plan
 */

import { useCallback, useEffect, useId, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ActivityMember, ActivityTask, ActivityTeam } from './activity-monitor.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import css from './ActivityPanel.module.css'

const PLAN_URL = '/plugins/dsh-agent-teams/plan'

type PlanFeedback = {
  readonly tone: 'success' | 'error'
  readonly message: string
}

type PlanModelSelection = {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
}

type EditorPendingChange = (key: string, pending: boolean) => void

function useDismissSuccess(
  feedback: PlanFeedback | undefined,
  setFeedback: (value: PlanFeedback | undefined) => void,
): void {
  useEffect(() => {
    if (feedback?.tone !== 'success') return
    const timeout = window.setTimeout(() => { setFeedback(undefined) }, 3_500)
    return () => { window.clearTimeout(timeout) }
  }, [feedback, setFeedback])
}

async function mutatePlan(payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(PLAN_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (response.ok) return
  let message = `HTTP ${response.status}`
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim() !== '') message = body.error
  } catch {}
  throw new Error(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function DisclosureChevron({ open }: { readonly open: boolean }) {
  return (
    <svg className={css.planChevron} data-open={open} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M4 2.5 7.5 6 4 9.5" />
    </svg>
  )
}

function Feedback({ value }: { readonly value: PlanFeedback | undefined }) {
  if (value === undefined) return null
  return (
    <span
      className={css.planFeedback}
      data-tone={value.tone}
      role={value.tone === 'error' ? 'alert' : 'status'}
      aria-live={value.tone === 'error' ? 'assertive' : 'polite'}
    >
      <span aria-hidden>
        {value.tone === 'success'
          ? <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m2.5 6.2 2.2 2.2 4.8-5" /></svg>
          : <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 2.3v4.1M6 8.8v.1" /></svg>}
      </span>
      {value.message}
    </span>
  )
}

function routeKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

type ModelMenuPane = 'root' | 'models' | 'effort'

const MODEL_MENU_OPEN_MODELS = 'open:models'
const MODEL_MENU_OPEN_EFFORT = 'open:effort'
const MODEL_MENU_BACK = 'navigate:back'
const MODEL_MENU_RETRY = 'action:retry'
const MODEL_MENU_DEFAULT_EFFORT = 'effort:default'

function modelMenuId(provider: string, model: string): string {
  return `model:${routeKey(provider, model)}`
}

function effortMenuId(effort: string): string {
  return `effort:${effort}`
}

/**
 * Thin staged-plan adapter over the official model directory. It deliberately
 * reads only catalog metadata: choosing a member route must not change the
 * captain session's composer model.
 */
function StagedModelPicker({
  directory,
  provider,
  model,
  reasoningEffort,
  busy,
  onChange,
  t,
}: {
  readonly directory: ModelDirectory
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly busy: boolean
  readonly onChange: (selection: PlanModelSelection) => void
  readonly t: AgentTeamsTranslate
}) {
  const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<ModelMenuPane>('root')
  const catalogRoutes = state.groups.flatMap((group) => group.models.map((candidate) => ({
    key: routeKey(group.id, candidate.id),
    provider: group.id,
    providerName: group.name,
    model: candidate,
  })))
  const selectedKey = routeKey(provider, model)
  const selected = catalogRoutes.find((candidate) => candidate.key === selectedKey)
  const efforts = selected?.model.reasoning?.efforts ?? []
  const currentMissing = provider !== '' && model !== '' && selected === undefined
  const defaultEffort = selected?.model.reasoning?.defaultEffort
  const effectiveEffort = reasoningEffort === '' || reasoningEffort === 'default'
    ? defaultEffort
    : reasoningEffort
  const selectedEffort = efforts.find((effort) => effort.id === effectiveEffort)
  const modelLabel = selected?.model.name
    ?? (model === '' ? t('plan.model.choose') : model)
  const effortLabel = selectedEffort?.name
    ?? (effectiveEffort === undefined ? t('plan.model.providerDefault') : effectiveEffort)
  const unavailable = state.status === 'error' || state.failures.length > 0

  const close = (): void => {
    setOpen(false)
    setPane('root')
  }

  const rootItems: readonly MenuEntry[] = [
    {
      id: MODEL_MENU_OPEN_MODELS,
      label: (
        <span className={css.planModelMenuRow}>
          <span>{t('plan.member.model')}</span>
          <strong>{modelLabel}</strong>
          <DisclosureChevron open={false} />
        </span>
      ),
      disabled: state.status === 'loading' && catalogRoutes.length === 0,
    },
    {
      id: MODEL_MENU_OPEN_EFFORT,
      label: (
        <span className={css.planModelMenuRow}>
          <span>{t('plan.member.reasoning')}</span>
          <strong>{effortLabel}</strong>
          <DisclosureChevron open={false} />
        </span>
      ),
      disabled: selected?.model.reasoning === undefined,
    },
  ]

  const modelItems: MenuEntry[] = [
    {
      id: MODEL_MENU_BACK,
      label: (
        <span className={css.planModelMenuBack}>
          <DisclosureChevron open={false} />
          {t('plan.model.back')}
        </span>
      ),
    },
    { type: 'separator', id: 'models:separator' },
  ]
  if (catalogRoutes.length === 0) {
    modelItems.push({
      id: 'models:empty',
      label: state.status === 'loading' ? t('plan.model.loading') : t('plan.model.empty'),
      disabled: true,
    })
  } else {
    for (const group of state.groups) {
      modelItems.push({ type: 'label', id: `provider:${group.id}`, text: group.name })
      for (const candidate of group.models) {
        modelItems.push({
          id: modelMenuId(group.id, candidate.id),
          label: candidate.name,
        })
      }
    }
  }

  const effortItems: MenuEntry[] = [
    {
      id: MODEL_MENU_BACK,
      label: (
        <span className={css.planModelMenuBack}>
          <DisclosureChevron open={false} />
          {t('plan.model.back')}
        </span>
      ),
    },
    { type: 'separator', id: 'effort:separator' },
    {
      id: MODEL_MENU_DEFAULT_EFFORT,
      label: defaultEffort === undefined
        ? t('plan.model.providerDefault')
        : t('plan.model.modelDefault', {
          effort: efforts.find((effort) => effort.id === defaultEffort)?.name ?? defaultEffort,
        }),
    },
    ...efforts.map((effort): MenuEntry => ({
      id: effortMenuId(effort.id),
      label: (
        <span className={css.planModelEffortRow}>
          <span>{effort.name}</span>
          {effort.description !== undefined && <small>{effort.description}</small>}
        </span>
      ),
    })),
  ]

  const items = pane === 'models' ? modelItems : pane === 'effort' ? effortItems : rootItems
  const selectedId = pane === 'models'
    ? modelMenuId(provider, model)
    : pane === 'effort'
      ? reasoningEffort === '' || reasoningEffort === 'default'
        ? MODEL_MENU_DEFAULT_EFFORT
        : effortMenuId(reasoningEffort)
      : undefined

  const choose = (id: string): void => {
    if (id === MODEL_MENU_OPEN_MODELS) {
      setPane('models')
      return
    }
    if (id === MODEL_MENU_OPEN_EFFORT) {
      setPane('effort')
      return
    }
    if (id === MODEL_MENU_BACK) {
      setPane('root')
      return
    }
    if (id === MODEL_MENU_RETRY) {
      void directory.load().catch(() => undefined)
      return
    }
    const nextModel = catalogRoutes.find((candidate) => modelMenuId(candidate.provider, candidate.model.id) === id)
    if (nextModel !== undefined) {
      close()
      if (nextModel.provider === provider && nextModel.model.id === model) return
      onChange({
        provider: nextModel.provider,
        model: nextModel.model.id,
        reasoningEffort: 'default',
      })
      return
    }
    if (id === MODEL_MENU_DEFAULT_EFFORT) {
      close()
      if (effectiveEffort === defaultEffort) return
      onChange({ provider, model, reasoningEffort: 'default' })
      return
    }
    const nextEffort = efforts.find((effort) => effortMenuId(effort.id) === id)
    if (nextEffort === undefined) return
    close()
    if (nextEffort.id === reasoningEffort) return
    onChange({ provider, model, reasoningEffort: nextEffort.id })
  }

  return (
    <div className={css.planModelPicker} data-model-directory-status={state.status}>
      <Menu
        open={open}
        portal
        align="end"
        compact
        className={css.planModelMenu}
        items={items}
        footer={unavailable ? [{ id: MODEL_MENU_RETRY, label: t('plan.model.retry') }] : undefined}
        selectedId={selectedId}
        onSelect={choose}
        onClose={close}
        anchor={(
          <button
            type="button"
            className={css.planModelTrigger}
            data-plan-model-trigger
            aria-label={t('plan.model.triggerAria', { model: modelLabel, effort: effortLabel })}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={busy}
            onClick={() => {
              if (open) close()
              else {
                setPane('root')
                setOpen(true)
                void directory.load().catch(() => undefined)
              }
            }}
          >
            <span className={css.planModelTriggerCopy}>
              <strong>{state.status === 'loading' && catalogRoutes.length === 0 ? t('plan.model.loading') : modelLabel}</strong>
              <span>{effortLabel}</span>
            </span>
            <DisclosureChevron open={open} />
          </button>
        )}
      />
      <small className={css.planModelHint}>
        {currentMissing
          ? t('plan.model.currentUnavailable', { provider, model })
          : selected?.model.description ?? t('plan.model.route', { provider, model })}
      </small>
      {unavailable && (
        <span className={css.planModelNotice} role={state.status === 'error' ? 'alert' : 'status'}>
          <span>{state.error ?? t('plan.model.partialFailure', { count: state.failures.length })}</span>
          <button type="button" disabled={busy || state.status === 'loading'} onClick={() => { void directory.load().catch(() => undefined) }}>
            {t('plan.model.retry')}
          </button>
        </span>
      )}
    </div>
  )
}

function StagedMemberEditor({ team, member, modelDirectory, onPendingChange, t }: {
  readonly team: ActivityTeam
  readonly member: ActivityMember
  readonly modelDirectory: ModelDirectory
  readonly onPendingChange: EditorPendingChange
  readonly t: AgentTeamsTranslate
}) {
  const bodyId = useId()
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState(member.role)
  const [provider, setProvider] = useState(member.provider ?? '')
  const [model, setModel] = useState(member.model ?? '')
  const [reasoningEffort, setReasoningEffort] = useState(member.reasoningEffort ?? '')
  const [executionPrompt, setExecutionPrompt] = useState(member.executionPrompt ?? '')
  const remoteSignature = JSON.stringify([
    member.role,
    member.provider ?? '',
    member.model ?? '',
    member.reasoningEffort ?? '',
    member.executionPrompt ?? '',
  ])
  const [savedSignature, setSavedSignature] = useState(remoteSignature)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<PlanFeedback>()
  useDismissSuccess(feedback, setFeedback)
  const signature = JSON.stringify([role, provider, model, reasoningEffort, executionPrompt])
  const dirty = signature !== savedSignature

  useEffect(() => {
    onPendingChange(`member:${member.name}`, dirty || busy)
    return () => { onPendingChange(`member:${member.name}`, false) }
  }, [busy, dirty, member.name, onPendingChange])

  useEffect(() => {
    setRole(member.role)
    setProvider(member.provider ?? '')
    setModel(member.model ?? '')
    setReasoningEffort(member.reasoningEffort ?? '')
    setExecutionPrompt(member.executionPrompt ?? '')
    setSavedSignature(remoteSignature)
  }, [member.role, member.provider, member.model, member.reasoningEffort, member.executionPrompt, remoteSignature])

  const markEdited = (): void => { setFeedback(undefined) }
  const persist = async (selection: PlanModelSelection = { provider, model, reasoningEffort }): Promise<void> => {
    const nextSignature = JSON.stringify([
      role,
      selection.provider,
      selection.model,
      selection.reasoningEffort,
      executionPrompt,
    ])
    setProvider(selection.provider)
    setModel(selection.model)
    setReasoningEffort(selection.reasoningEffort)
    setBusy(true)
    setFeedback(undefined)
    try {
      await mutatePlan({
        sessionId: team.captainSessionId,
        teamId: team.teamId,
        action: 'update_member',
        memberName: member.name,
        role,
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        executionPrompt,
      })
      setSavedSignature(nextSignature)
      setFeedback({ tone: 'success', message: t('plan.saved') })
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: t('plan.failed', { message: errorMessage(error) }) })
    } finally {
      setBusy(false)
    }
  }
  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    await persist()
  }

  const route = `${provider}/${model}`.replace(/^\//u, '')
  return (
    <article className={css.planCard} data-plan-member={member.name} data-open={open}>
      <button
        type="button"
        className={css.planCardHeader}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => { setOpen((current) => !current) }}
      >
        <span className={css.planCardIdentity}>
          <strong>{member.name}</strong>
          <span>{role || t('plan.member.roleFallback')}</span>
        </span>
        <span className={css.planCardMeta} title={route}>{route}</span>
        {dirty && <em className={css.planDirty}>{t('plan.unsaved')}</em>}
        <DisclosureChevron open={open} />
      </button>
      {open && (
        <form id={bodyId} className={css.planCardBody} onSubmit={(event) => { void save(event) }}>
          <fieldset disabled={busy}>
            <label>{t('plan.member.role')}<input name="role" value={role} onChange={(event) => { setRole(event.currentTarget.value); markEdited() }} /></label>
            <StagedModelPicker
              directory={modelDirectory}
              provider={provider}
              model={model}
              reasoningEffort={reasoningEffort}
              busy={busy}
              onChange={(selection) => { void persist(selection) }}
              t={t}
            />
            <label>{t('plan.member.prompt')}<textarea name="executionPrompt" value={executionPrompt} onChange={(event) => { setExecutionPrompt(event.currentTarget.value); markEdited() }} rows={3} /></label>
          </fieldset>
          <span className={css.planActions}>
            <Feedback value={feedback} />
            <button type="submit" disabled={busy || !dirty || provider.trim() === '' || model.trim() === ''}>
              {busy ? t('plan.saving') : t('plan.save')}
            </button>
          </span>
        </form>
      )}
    </article>
  )
}

function StagedTaskEditor({ team, task, onPendingChange, t }: {
  readonly team: ActivityTeam
  readonly task: ActivityTask
  readonly onPendingChange: EditorPendingChange
  readonly t: AgentTeamsTranslate
}) {
  const bodyId = useId()
  const taskDependencies = task.dependencies.join(', ')
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState(task.subject)
  const [description, setDescription] = useState(task.description ?? '')
  const [assignee, setAssignee] = useState(task.assignee)
  const [dependencies, setDependencies] = useState(taskDependencies)
  const remoteSignature = JSON.stringify([task.subject, task.description ?? '', task.assignee, taskDependencies])
  const [savedSignature, setSavedSignature] = useState(remoteSignature)
  const [busy, setBusy] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [feedback, setFeedback] = useState<PlanFeedback>()
  useDismissSuccess(feedback, setFeedback)
  const signature = JSON.stringify([subject, description, assignee, dependencies])
  const dirty = signature !== savedSignature

  useEffect(() => {
    onPendingChange(`task:${task.id}`, dirty || busy)
    return () => { onPendingChange(`task:${task.id}`, false) }
  }, [busy, dirty, onPendingChange, task.id])

  useEffect(() => {
    setSubject(task.subject)
    setDescription(task.description ?? '')
    setAssignee(task.assignee)
    setDependencies(taskDependencies)
    setSavedSignature(remoteSignature)
  }, [task.subject, task.description, task.assignee, taskDependencies, remoteSignature])

  const markEdited = (): void => {
    setFeedback(undefined)
    setConfirmingRemove(false)
  }
  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setFeedback(undefined)
    try {
      await mutatePlan({
        sessionId: team.captainSessionId,
        teamId: team.teamId,
        action: 'update_task',
        taskId: task.id,
        subject,
        description,
        assignee,
        dependencies: dependencies.split(',').map((item) => item.trim()).filter(Boolean),
      })
      setSavedSignature(signature)
      setFeedback({ tone: 'success', message: t('plan.saved') })
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: t('plan.failed', { message: errorMessage(error) }) })
    } finally {
      setBusy(false)
    }
  }
  const remove = async (): Promise<void> => {
    setBusy(true)
    setFeedback(undefined)
    try {
      await mutatePlan({
        sessionId: team.captainSessionId,
        teamId: team.teamId,
        action: 'remove_task',
        taskId: task.id,
      })
      setFeedback({ tone: 'success', message: t('plan.removed') })
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: t('plan.failed', { message: errorMessage(error) }) })
      setBusy(false)
    }
  }

  const dependencySummary = task.dependencies.length === 0
    ? t('plan.dependencies.none')
    : t('plan.dependencies.count', { count: task.dependencies.length })
  return (
    <article className={css.planCard} data-plan-task={task.id} data-open={open}>
      <button
        type="button"
        className={css.planCardHeader}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => { setOpen((current) => !current) }}
      >
        <span className={css.planTaskId}>{task.id}</span>
        <span className={css.planTaskSummary} title={subject}>{subject}</span>
        <span className={css.planCardMeta}>{assignee || t('plan.task.unassigned')} · {dependencySummary}</span>
        {dirty && <em className={css.planDirty}>{t('plan.unsaved')}</em>}
        <DisclosureChevron open={open} />
      </button>
      {open && (
        <form id={bodyId} className={css.planCardBody} onSubmit={(event) => { void save(event) }}>
          <fieldset disabled={busy}>
            <label>{t('plan.task.subject')}<input name="subject" required value={subject} onChange={(event) => { setSubject(event.currentTarget.value); markEdited() }} /></label>
            <label>{t('plan.task.description')}<textarea name="description" value={description} onChange={(event) => { setDescription(event.currentTarget.value); markEdited() }} rows={3} /></label>
            <span className={css.planGrid}>
              <label>{t('plan.task.assignee')}
                <select name="assignee" value={assignee} onChange={(event) => { setAssignee(event.currentTarget.value); markEdited() }}>
                  <option value="">{t('plan.task.unassigned')}</option>
                  {team.members.map((member) => <option key={member.name} value={member.name}>{member.name}</option>)}
                </select>
              </label>
              <label>
                {t('plan.task.dependencies')}
                <input name="dependencies" value={dependencies} onChange={(event) => { setDependencies(event.currentTarget.value); markEdited() }} />
                <small>{t('plan.task.dependenciesHint')}</small>
              </label>
            </span>
          </fieldset>
          {confirmingRemove && (
            <span className={css.planConfirm} role="alert">
              <span>{t('plan.removeWarning', { task: task.id })}</span>
              <button type="button" onClick={() => { setConfirmingRemove(false) }}>{t('plan.cancel')}</button>
              <button type="button" data-danger data-confirming onClick={() => { void remove() }}>{t('plan.removeConfirm')}</button>
            </span>
          )}
          <span className={css.planActions}>
            <Feedback value={feedback} />
            <button type="button" data-danger onClick={() => { setConfirmingRemove(true); setFeedback(undefined) }} disabled={busy || confirmingRemove}>{t('plan.remove')}</button>
            <button type="submit" disabled={busy || !dirty || subject.trim() === ''}>{busy ? t('plan.saving') : t('plan.save')}</button>
          </span>
        </form>
      )}
    </article>
  )
}

export function StagingPlanEditor({ team, modelDirectory, onContinuePlanning, onDiscarded, t }: {
  readonly team: ActivityTeam
  readonly modelDirectory: ModelDirectory
  readonly onContinuePlanning: () => void
  readonly onDiscarded: () => void
  readonly t: AgentTeamsTranslate
}) {
  const membersId = useId()
  const tasksId = useId()
  const [membersOpen, setMembersOpen] = useState(true)
  const [tasksOpen, setTasksOpen] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [discardArmed, setDiscardArmed] = useState(false)
  const [pendingEditors, setPendingEditors] = useState<ReadonlySet<string>>(new Set())
  const [feedback, setFeedback] = useState<PlanFeedback>()
  useDismissSuccess(feedback, setFeedback)
  const dependencyLinks = team.tasks.reduce((total, task) => total + task.dependencies.length, 0)
  const runnable = team.members.length > 0 && team.tasks.length > 0
  const hasPendingEdits = pendingEditors.size > 0 || newTask.trim() !== ''
  const waitingForFeedback = team.planReviewState === 'awaiting_feedback'

  useEffect(() => {
    void modelDirectory.load().catch(() => undefined)
  }, [modelDirectory])

  const onPendingChange = useCallback<EditorPendingChange>((key, pending) => {
    setPendingEditors((current) => {
      if (pending === current.has(key)) return current
      const next = new Set(current)
      if (pending) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const addTask = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setFeedback(undefined)
    try {
      await mutatePlan({
        sessionId: team.captainSessionId,
        teamId: team.teamId,
        action: 'add_task',
        subject: newTask,
        dependencies: [],
      })
      setNewTask('')
      setFeedback({ tone: 'success', message: t('plan.taskAdded') })
      setTasksOpen(true)
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: t('plan.failed', { message: errorMessage(error) }) })
    } finally {
      setBusy(false)
    }
  }

  const approve = async (): Promise<void> => {
    setBusy(true)
    setFeedback(undefined)
    try {
      await mutatePlan({
        sessionId: team.captainSessionId,
        teamId: team.teamId,
        action: 'approve',
      })
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: t('plan.failed', { message: errorMessage(error) }) })
      setBusy(false)
    }
  }

  const continueInChat = async (): Promise<void> => {
    if (waitingForFeedback) {
      onContinuePlanning()
      return
    }
    setBusy(true)
    setFeedback(undefined)
    try {
      await mutatePlan({
        sessionId: team.captainSessionId,
        teamId: team.teamId,
        action: 'continue',
      })
      onContinuePlanning()
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: t('plan.failed', { message: errorMessage(error) }) })
      setBusy(false)
    }
  }

  const discard = async (): Promise<void> => {
    setBusy(true)
    setFeedback(undefined)
    try {
      await mutatePlan({
        sessionId: team.captainSessionId,
        teamId: team.teamId,
        action: 'discard',
      })
      onDiscarded()
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: t('plan.failed', { message: errorMessage(error) }) })
      setBusy(false)
      setDiscardArmed(false)
    }
  }

  return (
    <section className={css.planEditor} data-staging-editor>
      <header className={css.planHeader}>
        <span>
          <span>
            <strong>{t('plan.title')}</strong>
            <small>{t('plan.readySummary', { members: team.members.length, tasks: team.tasks.length, links: dependencyLinks })}</small>
          </span>
          <em>{t('plan.badge')}</em>
        </span>
        <p>{t('plan.description')}</p>
      </header>

      <ol className={css.planFlow} aria-label={t('plan.flow.aria')}>
        <li data-active><span>1</span>{t('plan.flow.review')}</li>
        <li><span>2</span>{t('plan.flow.spawn')}</li>
        <li><span>3</span>{t('plan.flow.run')}</li>
      </ol>

      <section className={css.planSection}>
        <button type="button" className={css.planSectionToggle} aria-expanded={membersOpen} aria-controls={membersId} onClick={() => { setMembersOpen((current) => !current) }}>
          <span><strong>{t('plan.members.title')}</strong><small>{t('plan.members.count', { count: team.members.length })}</small></span>
          <DisclosureChevron open={membersOpen} />
        </button>
        {membersOpen && (
          <div id={membersId} className={css.planList}>
            {team.members.length === 0
              ? <p className={css.planEmpty}>{t('plan.members.empty')}</p>
              : team.members.map((member) => (
                <StagedMemberEditor
                  key={member.name}
                  team={team}
                  member={member}
                  modelDirectory={modelDirectory}
                  onPendingChange={onPendingChange}
                  t={t}
                />
              ))}
          </div>
        )}
      </section>

      <section className={css.planSection}>
        <button type="button" className={css.planSectionToggle} aria-expanded={tasksOpen} aria-controls={tasksId} onClick={() => { setTasksOpen((current) => !current) }}>
          <span><strong>{t('plan.tasks.title')}</strong><small>{t('plan.tasks.count', { count: team.tasks.length, links: dependencyLinks })}</small></span>
          <DisclosureChevron open={tasksOpen} />
        </button>
        {tasksOpen && (
          <div id={tasksId} className={css.planList}>
            {team.tasks.length === 0
              ? <p className={css.planEmpty}>{t('plan.tasks.empty')}</p>
              : team.tasks.map((task) => <StagedTaskEditor key={task.id} team={team} task={task} onPendingChange={onPendingChange} t={t} />)}
          </div>
        )}
      </section>

      <form className={css.planNewTask} onSubmit={(event) => { void addTask(event) }}>
        <label>
          <span>{t('plan.newTaskLabel')}</span>
          <input name="newTask" value={newTask} onChange={(event) => { setNewTask(event.currentTarget.value); setFeedback(undefined) }} placeholder={t('plan.newTask')} disabled={busy} />
        </label>
        <button type="submit" disabled={busy || newTask.trim() === ''}>{busy ? t('plan.adding') : t('plan.addTask')}</button>
      </form>

      <div
        className={css.planApproveRow}
        data-armed={discardArmed || undefined}
        data-discard={discardArmed || undefined}
        data-review-state={waitingForFeedback ? 'awaiting-feedback' : 'awaiting-review'}
      >
        <span className={css.planApproveCopy}>
          <strong>{discardArmed
            ? t('plan.discardConfirmTitle')
            : waitingForFeedback
              ? t('plan.feedbackTitle')
              : t('plan.approveTitle')}</strong>
          <small>{discardArmed
            ? t('plan.discardWarning')
            : waitingForFeedback
              ? t('plan.feedbackHint')
              : hasPendingEdits
                ? t('plan.pendingEdits')
                : t('plan.approveHint', { members: team.members.length, tasks: team.tasks.length })}</small>
        </span>
        <Feedback value={feedback} />
        {discardArmed ? (
          <span className={css.planApproveActions}>
            <button type="button" disabled={busy} onClick={() => { setDiscardArmed(false) }}>{t('plan.cancel')}</button>
            <button type="button" data-plan-discard data-danger data-confirming disabled={busy} onClick={() => { void discard() }}>
              {busy ? t('plan.discarding') : t('plan.discardConfirm')}
            </button>
          </span>
        ) : (
          <span className={css.planReviewActions}>
            <button type="button" data-plan-approve disabled={busy || !runnable || hasPendingEdits} onClick={() => { void approve() }}>
              {t('plan.approve')}
            </button>
            <span className={css.planSecondaryActions}>
              <button type="button" data-plan-continue disabled={busy} onClick={() => { void continueInChat() }}>
                {t(waitingForFeedback ? 'plan.returnToChat' : 'plan.continue')}
              </button>
              <button type="button" data-plan-discard data-danger disabled={busy} onClick={() => { setDiscardArmed(true); setFeedback(undefined) }}>{t('plan.discard')}</button>
            </span>
          </span>
        )}
      </div>
    </section>
  )
}
