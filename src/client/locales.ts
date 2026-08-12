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
  'member.working': '工作中',
  'member.role': '{role}',
  'member.open': '打开 {name}',
  'member.current': '当前任务',
  'task.none': '暂无任务',
  'task.state.blocked': '阻塞',
  'task.state.open': '待领取',
  'task.state.running': '进行中',
  'task.state.completed': '已完成',
  'task.dependsOn': '← {deps}',
  'task.start': '起点',
  'task.unlocked': '解锁',
  'feed.title': '消息 {count}',
  'feed.show': '展开消息',
  'feed.hide': '收起消息',
  'feed.empty': '暂无消息',
  'feed.category.assignment': '分派',
  'feed.category.peer': '成员',
  'feed.category.report': '汇报',
  'feed.category.system': '系统',
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
  'member.working': 'Working',
  'member.role': '{role}',
  'member.open': 'Open {name}',
  'member.current': 'Current',
  'task.none': 'No tasks',
  'task.state.blocked': 'Blocked',
  'task.state.open': 'Open',
  'task.state.running': 'Running',
  'task.state.completed': 'Completed',
  'task.dependsOn': '← {deps}',
  'task.start': 'Start',
  'task.unlocked': 'Unlocked',
  'feed.title': 'Messages {count}',
  'feed.show': 'Show messages',
  'feed.hide': 'Hide messages',
  'feed.empty': 'No messages yet',
  'feed.category.assignment': 'Assign',
  'feed.category.peer': 'Peer',
  'feed.category.report': 'Report',
  'feed.category.system': 'System',
  'team.deleted': 'Team deleted',
  'empty': 'No members yet',
}

/** Union of this namespace's dictionary keys. */
export type AgentTeamsKey = keyof typeof zh
