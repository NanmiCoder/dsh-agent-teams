/**
 * Editable pre-run roster and DAG review for staged AgentTeams plans.
 *
 * This leaf owns only transient form/disclosure state. Durable truth remains
 * on the host and returns through the ordinary activity polling snapshot.
 * @module dsh-agent-teams/client/staging-plan
 */

import { useEffect, useId, useState, type FormEvent } from 'react'
import type { ActivityMember, ActivityTask, ActivityTeam } from './activity-monitor.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import css from './ActivityPanel.module.css'

const PLAN_URL = '/plugins/dsh-agent-teams/plan'

type PlanFeedback = {
  readonly tone: 'success' | 'error'
  readonly message: string
}

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

function StagedMemberEditor({ team, member, t }: {
  readonly team: ActivityTeam
  readonly member: ActivityMember
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
    setRole(member.role)
    setProvider(member.provider ?? '')
    setModel(member.model ?? '')
    setReasoningEffort(member.reasoningEffort ?? '')
    setExecutionPrompt(member.executionPrompt ?? '')
    setSavedSignature(remoteSignature)
  }, [member.role, member.provider, member.model, member.reasoningEffort, member.executionPrompt, remoteSignature])

  const markEdited = (): void => { setFeedback(undefined) }
  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setFeedback(undefined)
    try {
      await mutatePlan({
        sessionId: team.captainSessionId,
        teamId: team.teamId,
        action: 'update_member',
        memberName: member.name,
        role,
        provider,
        model,
        reasoningEffort,
        executionPrompt,
      })
      setSavedSignature(signature)
      setFeedback({ tone: 'success', message: t('plan.saved') })
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: t('plan.failed', { message: errorMessage(error) }) })
    } finally {
      setBusy(false)
    }
  }

  const route = `${member.provider ?? ''}/${member.model ?? ''}`.replace(/^\//u, '')
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
            <span className={css.planGrid}>
              <label>{t('plan.member.provider')}<input name="provider" required value={provider} onChange={(event) => { setProvider(event.currentTarget.value); markEdited() }} /></label>
              <label>{t('plan.member.model')}<input name="model" required value={model} onChange={(event) => { setModel(event.currentTarget.value); markEdited() }} /></label>
            </span>
            <label>
              {t('plan.member.reasoning')}
              <input name="reasoningEffort" value={reasoningEffort} onChange={(event) => { setReasoningEffort(event.currentTarget.value); markEdited() }} placeholder="default" />
              <small>{t('plan.member.reasoningHint')}</small>
            </label>
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

function StagedTaskEditor({ team, task, t }: {
  readonly team: ActivityTeam
  readonly task: ActivityTask
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

export function StagingPlanEditor({ team, t }: {
  readonly team: ActivityTeam
  readonly t: AgentTeamsTranslate
}) {
  const membersId = useId()
  const tasksId = useId()
  const [membersOpen, setMembersOpen] = useState(true)
  const [tasksOpen, setTasksOpen] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [approvalArmed, setApprovalArmed] = useState(false)
  const [feedback, setFeedback] = useState<PlanFeedback>()
  useDismissSuccess(feedback, setFeedback)
  const dependencyLinks = team.tasks.reduce((total, task) => total + task.dependencies.length, 0)
  const runnable = team.members.length > 0 && team.tasks.length > 0

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
      setApprovalArmed(false)
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
              : team.members.map((member) => <StagedMemberEditor key={member.name} team={team} member={member} t={t} />)}
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
              : team.tasks.map((task) => <StagedTaskEditor key={task.id} team={team} task={task} t={t} />)}
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

      <div className={css.planApproveRow} data-armed={approvalArmed}>
        <span className={css.planApproveCopy}>
          <strong>{approvalArmed ? t('plan.approveConfirmTitle') : t('plan.approveTitle')}</strong>
          <small>{approvalArmed
            ? t('plan.approveWarning')
            : t('plan.approveHint', { members: team.members.length, tasks: team.tasks.length })}</small>
        </span>
        <Feedback value={feedback} />
        {approvalArmed ? (
          <span className={css.planApproveActions}>
            <button type="button" disabled={busy} onClick={() => { setApprovalArmed(false) }}>{t('plan.cancel')}</button>
            <button type="button" data-plan-approve data-confirming disabled={busy || !runnable} onClick={() => { void approve() }}>
              {busy ? t('plan.approving') : t('plan.approveConfirm')}
            </button>
          </span>
        ) : (
          <button type="button" data-plan-approve disabled={busy || !runnable} onClick={() => { setApprovalArmed(true); setFeedback(undefined) }}>
            {t('plan.approve')}
          </button>
        )}
      </div>
    </section>
  )
}
