/** `agentTeams` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'agentTeams'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '{name}',
  'status.running': '运行中',
  'status.deleted': '已删除',
  'captain': '队长',
  'members.one': '{count} 名成员',
  'members.other': '{count} 名成员',
  'member.idle': '空闲',
  'member.role': '{role}',
  'member.open': '打开 {name}',
  'task.none': '暂无任务',
  'task.status.pending': '待领取',
  'task.status.claimed': '已领取',
  'task.status.in_progress': '进行中',
  'task.status.completed': '已完成',
  'task.status.failed': '失败',
  'task.status.cancelled': '已取消',
  'team.deleted': '团队已删除',
  'empty': '还没有成员',
}

/** English dictionary (same key set). */
export const en: Record<AgentTeamsKey, string> = {
  'title': '{name}',
  'status.running': 'Running',
  'status.deleted': 'Deleted',
  'captain': 'Team Lead',
  'members.one': '{count} member',
  'members.other': '{count} members',
  'member.idle': 'Idle',
  'member.role': '{role}',
  'member.open': 'Open {name}',
  'task.none': 'No tasks',
  'task.status.pending': 'Pending',
  'task.status.claimed': 'Claimed',
  'task.status.in_progress': 'In progress',
  'task.status.completed': 'Completed',
  'task.status.failed': 'Failed',
  'task.status.cancelled': 'Cancelled',
  'team.deleted': 'Team deleted',
  'empty': 'No members yet',
}

/** Union of this namespace's dictionary keys. */
export type AgentTeamsKey = keyof typeof zh
