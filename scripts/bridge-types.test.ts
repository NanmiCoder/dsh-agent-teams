import type { AgentTeamsBridgeEventPublisher } from '../src/bridge-runtime.ts'

declare const publisher: AgentTeamsBridgeEventPublisher

void publisher.publishActive('task-updated', '/state', 'team', 'task')
void publisher.publishActive('team-halted', '/state', 'team')

// @ts-expect-error task-updated events require the affected task id.
void publisher.publishActive('task-updated', '/state', 'team')
// @ts-expect-error team lifecycle events cannot accidentally carry a task id.
void publisher.publishActive('team-halted', '/state', 'team', 'task')
