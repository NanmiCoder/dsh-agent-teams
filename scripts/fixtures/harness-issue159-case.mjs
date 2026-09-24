/** Real-provider issue #159 acceptance: burst messaging plus late evidence and cold recovery. */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as review from './harness-model-case.mjs';
export const { sources, coldPrompt, verifySeededBehavior, modelMetrics } = review;
export const freshPrompt = review.freshPrompt + `
额外的消息与证据验收：
队长分配后，给 performance 连续发送 12 条带序号的简短审查提醒 AUDIT_CAPTAIN_01 至 AUDIT_CAPTAIN_12；security 在自己的任务中给 performance 连续发送 12 条提醒 AUDIT_PEER_01 至 AUDIT_PEER_12。都使用 agent_teams_send_message。提醒只说明按当前源码一次性审查，不需逐条回复，不重复建任务或返工。成员发任务消息时带上来源 source_task_id 和 source_attempt_id；队长普通提醒不填来源字段。
三位成员各自在自己的任务已经 update_task completed 后，独立计算自己 reports/<名字>.json 的 SHA-256，再调用 update_task（原 task_id、原 attempt_id、status=completed），以 commandsRun:[{command:"实际执行的哈希计算命令",status:"passed",exitCode:0,evidence:"实际哈希"}] 补录晚到的证据，并用 evidence_note 说明是完成后的独立复核。不要改原 output、不要重新 claim、不要新建补记任务。然后再发一次最终汇报给队长。队长等待三个成员补录完成再汇总。`;
export function evaluate(workspace, captainId, events, phase, previous) {
  const result = review.evaluate(workspace, captainId, events, phase, previous);
  const team = review.teamIn(workspace, captainId);
  for (const name of review.reviewers) {
    const path = join(workspace, `reports/${name}.json`);
    const hash = existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : '';
    const task = team?.tasks.find(t => t.assignee === name && t.supplementalEvidence?.some(e => e.by === name && e.attemptId === t.attemptId && e.commandsRun?.some(c => c.command.includes(`reports/${name}.json`) && c.status === 'passed' && c.evidence?.includes(hash))));
    result.checks[`lateEvidence:${name}`] = Boolean(hash && task);
  }
  if (phase === 'fresh') {
    const sent = events.filter(e => e.event === 'tool-result' && e.name === 'agent_teams_send_message' && !e.isError && e.arguments?.to === 'performance');
    result.checks.captainBurst = sent.filter(e => e.sessionId === captainId && /AUDIT_CAPTAIN_/.test(e.arguments.content)).length >= 12;
    const securityId = team?.members.find(m => m.name === 'security')?.id;
    result.checks.peerBurst = sent.filter(e => e.sessionId === securityId && /AUDIT_PEER_/.test(e.arguments.content)).length >= 12;
  }
  result.passed = Object.values(result.checks).every(Boolean);
  return result;
}
