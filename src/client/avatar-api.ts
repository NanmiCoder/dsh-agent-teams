/** Browser client for the CSRF-protected host avatar mutation endpoint. */

import type { ActivityTeam } from './activity-monitor.ts'

const AVATAR_URL = '/plugins/dsh-agent-teams/avatar'

export type AvatarTarget = { readonly kind: 'captain' } | { readonly kind: 'member'; readonly name: string }

function mutationUrl(team: ActivityTeam, target: AvatarTarget): string {
  const query = new URLSearchParams({
    team_id: team.teamId,
    captain_session_id: team.captainSessionId,
    target: target.kind,
  })
  if (target.kind === 'member') query.set('member', target.name)
  return `${AVATAR_URL}?${query.toString()}`
}

async function avatarRequest(
  team: ActivityTeam,
  target: AvatarTarget,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: BodyInit,
  headers: Record<string, string> = {},
): Promise<void> {
  if (team.avatarEditToken === undefined) throw new Error('avatar editing is unavailable for this team')
  const response = await fetch(mutationUrl(team, target), {
    method,
    body,
    headers: {
      'x-agent-teams-request': 'avatar-v1',
      'x-agent-teams-avatar-token': team.avatarEditToken,
      ...headers,
    },
  })
  if (response.ok) return
  let message = `avatar request failed (${response.status})`
  try {
    const parsed = await response.json() as { error?: unknown }
    if (typeof parsed.error === 'string') message = parsed.error
  } catch {
    // Preserve the status-based fallback for a host restart or non-JSON error.
  }
  throw new Error(message)
}

export async function setAvatarUrl(team: ActivityTeam, target: AvatarTarget, url: string): Promise<void> {
  await avatarRequest(team, target, 'PUT', JSON.stringify({ url }), { 'content-type': 'application/json' })
}

export async function uploadAvatarFile(team: ActivityTeam, target: AvatarTarget, file: File): Promise<void> {
  await avatarRequest(team, target, 'POST', file, {
    'content-type': file.type,
    'x-agent-teams-file-name': encodeURIComponent(file.name),
  })
}

export async function clearAvatar(team: ActivityTeam, target: AvatarTarget): Promise<void> {
  await avatarRequest(team, target, 'DELETE')
}
