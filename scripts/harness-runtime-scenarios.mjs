/** Shared built-product scenarios for registry releases and explicitly identified source checkouts. */
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export const runtimeScenarios = ['lifecycle', 'fallback', 'failure', 'captain-idle-wakeup', 'progressive-entry', 'web-approval', 'protocol-compatibility', 'stability'];

/** Run the same fixture and persisted-state assertions against an already prepared runtime. */
export async function runRuntimeScenarios({ report, runtime, command, environment, selectedScenarios = runtimeScenarios, linkWorkspacePackages = false }) {
const runs = [];
for (const scenario of selectedScenarios) {
    const home = join(report, scenario, 'home'), profile = join(home, 'profiles', 'headless'), workspace = join(report, scenario, 'workspace');
    mkdirSync(profile, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(profile, 'node_modules/@nanmicoder'), { recursive: true });
    if (linkWorkspacePackages) symlinkSync(join(runtime, 'node_modules/@deepseek-ai'), join(profile, 'node_modules/@deepseek-ai'), 'dir');
    symlinkSync(join(runtime, 'node_modules/@nanmicoder/dsh-agent-teams'), join(profile, 'node_modules/@nanmicoder/dsh-agent-teams'), 'dir');
    json(join(profile, 'package.json'), { name: 'runtime-test-profile', version: '0.0.0', private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@nanmicoder/dsh-agent-teams'], patchReload: 'startup' } } });
    copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-llm.mjs'), join(profile, 'fixture-llm.mjs'));
    writeFileSync(join(profile, 'cordis.patch.yml'), `- id: llm-deepseek\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: runtime-lab\n    model: fixture-model\n- insert:\n    - id: runtime-lab-fixture\n      name: './fixture-llm.mjs'\n`);
    if (scenario === 'lifecycle')
        // Regression for #163/#164: rename the delegation tool so no global
        // tool named `subagent` exists, mirroring compositions where the
        // host configured a different toolName. The default-depth member
        // spawn must still succeed instead of dying in tools.restrict().
        // Patch entries replace a same-id entry wholesale, so repeat the
        // full dsh-base configuration and change only the tool name.
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + '- id: tool-subagent\n  name: \'@deepseek-ai/dsh-tool-subagent\'\n  config:\n    provider: spawn\n    toolName: subagent_legacy\n    backgroundMode: continuable\n');
    if (scenario === 'fallback')
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + '- id: agent-teams\n  config:\n    stateDir: .agent-teams\n    memberProvider: spawn\n    fallback:\n      provider: runtime-lab\n      model: fixture-fallback\n');
    if (scenario === 'captain-idle-wakeup') {
        copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-idle.mjs'), join(profile, 'fixture-idle.mjs'));
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + '- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- insert:\n    - id: runtime-lab-idle-captain\n      name: ./fixture-idle.mjs\n');
    }
    if (scenario === 'progressive-entry') {
        copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-entry.mjs'), join(profile, 'fixture-entry.mjs'));
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + `- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- id: agent-teams
  config:
    profiles:
      demo-profile:
        description: Entry benchmark roster
        taskPlanning: captain
        members:
          - name: worker
            role: MEMBER_FIXTURE
            executionPrompt: 'MEMBER_FIXTURE: complete the assigned task and report.'
            reasoning_effort: high
- insert:
    - id: runtime-lab-progressive-entry
      name: ./fixture-entry.mjs
`);
    }
    if (scenario === 'web-approval') {
        copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-web-approval.mjs'), join(profile, 'fixture-web-approval.mjs'));
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + `- id: runtime-lab-fixture
  disabled: true
- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- id: credentials
  disabled: false
- insert:
    - id: runtime-lab-webserver
      name: '@deepseek-ai/dsh-host-webserver'
      config:
        host: 127.0.0.1
        port: 0
    - id: runtime-lab-connection
      name: '@deepseek-ai/dsh-client-connection'
    - id: runtime-lab-workspace
      name: '@deepseek-ai/dsh-workspace'
    - id: runtime-lab-web-approval
      name: ./fixture-web-approval.mjs
`);
    }
    if (scenario === 'protocol-compatibility') {
        copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-protocol.mjs'), join(profile, 'fixture-protocol.mjs'));
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + `- id: runtime-lab-fixture
  disabled: true
- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- id: agent-teams
  config:
    profiles:
      north:
        protocol: Investigate an existing codebase and design a goal-specific task DAG.
        taskPlanning: captain
        members:
          - name: worker
            role: Research the existing implementation
      south:
        protocol: Apply a fixed release-readiness checklist to a prepared release.
        taskPlanning: seed
        members:
          - name: reviewer
            role: Review release readiness
        tasks:
          - id: release-check
            subject: Check the release checklist
            assignee: reviewer
- insert:
    - id: runtime-lab-protocol-compatibility
      name: ./fixture-protocol.mjs
`);
    }
    if (scenario === 'stability') {
        copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-stability.mjs'), join(profile, 'fixture-stability.mjs'));
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + `- id: runtime-lab-fixture
  disabled: true
- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- id: agent-teams
  config:
    memberMaxDepth: 1
    toolPolicies:
      restricted:
        deny: [lab_forbidden]
- insert:
    - id: runtime-lab-stability
      name: ./fixture-stability.mjs
`);
    }
    const tracePath = join(report, scenario, 'trace.jsonl');
    const result = await command([process.execPath, join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'headless', 'Run the authorized deterministic AgentTeams fixture immediately.'], workspace, environment({ DSH_HOME: home, DSH_PERMISSION_MODE: 'danger-full-access', DSH_TELEMETRY_DISABLED: '1', LAB_TRACE: tracePath, LAB_TEAMS: '1', LAB_SCENARIO: scenario }), scenario, 90000);
    const trace = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
    if (scenario === 'stability') {
        const checks = ['hmr', 'lazy-start', 'running-plan-correction', 'steering', 'read-receipt-continuation', 'reassign', 'archive', 'batch-plan', 'terminal-evidence', 'report-retry', 'settlement-dedup'];
        const assertions = { exit0: result.code === 0 && !result.timedOut, productMarker: result.stdout.includes('STABILITY_OK'), ...Object.fromEntries(checks.map(check => [check, trace.some(x => x.event === `stability-${check}-passed`)])) };
        runs.push({ scenario, passed: Object.values(assertions).every(Boolean), assertions, evidence: trace.filter(x => checks.some(check => x.event === `stability-${check}-passed`)), exit: { code: result.code, signal: result.signal, timedOut: result.timedOut } });
        continue;
    }
    if (scenario === 'protocol-compatibility') {
        const cases = trace.filter(x => x.event === 'protocol-case-passed');
        const assertions = { exit0: result.code === 0 && !result.timedOut, productMarker: result.stdout.includes('PROTOCOL_COMPATIBILITY_OK'), legacyAllowlistAndColdRestore: cases.some(x => x.label === 'legacy-allowlist-cold-compact') && trace.some(x => x.event === 'protocol-cold-restored'), legacyProfileDirectory: trace.some(x => x.event === 'protocol-legacy-profile-directory' && x.onlyOriginalTools === true && x.northPurposeVisible && x.southPurposeVisible) && cases.some(x => x.label === 'legacy-allowlist-cold-compact' && x.profile === 'north'), actualPtcDiscard: cases.some(x => x.label === 'ptc-discard-and-compact') && trace.some(x => x.event === 'protocol-ptc-output-discarded' && x.tool === 'agent_teams_status'), actualPruning: trace.some(x => x.event === 'protocol-pruned'), actualCompaction: trace.filter(x => x.event === 'protocol-compacted').length === 2, existingPlanRevised: cases.length === 2 && cases.every(x => x.persistedSubject === 'Recovered task'), lifecycleArchived: cases.length === 2 && cases.every(x => x.archived === true) };
        runs.push({ scenario, passed: Object.values(assertions).every(Boolean), assertions, cases, exit: { code: result.code, signal: result.signal, timedOut: result.timedOut } });
        continue;
    }
    if (scenario === 'progressive-entry') {
        const cases = trace.filter(x => x.event === 'entry-case-passed').map(x => x.label);
        const stablePrefixes = trace.filter(x => x.event === 'stable-prefix-passed');
        const labels = ['natural', 'natural-zh', 'raw-slash', 'command', 'profile-command', 'profile-raw'];
        const assertions = { exit0: result.code === 0 && !result.timedOut, productMarker: result.stdout.includes('PROGRESSIVE_ENTRY_OK'), allEntries: labels.every(label => cases.includes(label)), stablePrefixes: labels.every(label => stablePrefixes.some(x => x.label === label)), thirtyOrdinaryTurns: stablePrefixes.some(x => x.label === 'natural' && x.precedingOrdinaryTurns === 30) };
        runs.push({ scenario, passed: Object.values(assertions).every(Boolean), assertions, cases, exit: { code: result.code, signal: result.signal, timedOut: result.timedOut } });
        continue;
    }
    if (scenario === 'web-approval') {
        const staged = trace.find(x => x.event === 'web-staged-idle'), approved = trace.find(x => x.event === 'web-http-approved');
        const approvalWake = trace.find(x => x.event === 'web-captain-approval-wake'), yielded = trace.find(x => x.event === 'web-approved-idle');
        const released = trace.find(x => x.event === 'web-member-output-released'), reportWake = trace.find(x => x.event === 'web-captain-report-wake');
        const evidence = trace.find(x => x.event === 'web-approval-passed');
        const invalid = trace.find(x => x.event === 'web-http-invalid-team-rejected'), repeated = trace.find(x => x.event === 'web-http-repeat-rejected');
        const stable = trace.find(x => x.event === 'web-headers-stable');
        const assertions = { claimedProjection: trace.some(x => x.event === 'web-claimed-projection' && x.taskStatus === 'claimed' && x.visualState === 'claimed' && x.memberActivity === 'working'), exit0: result.code === 0 && !result.timedOut, productMarker: result.stdout.includes('WEB_APPROVAL_OK'), driverCompleted: Boolean(evidence), stagedBeforeApproval: Boolean(staged?.status === 'idle' && approved?.status === 200 && staged.order < approved.order), independentApprovalWake: Boolean(approvalWake && yielded?.status === 'idle' && released && approvalWake.order < yielded.order && yielded.order < released.order), reportWakeAfterYield: Boolean(released && reportWake && released.order < reportWake.order && reportWake.sessionId === staged?.sessionId), noPollingOrDuplicateApproval: !trace.some(x => x.event === 'web-model-tool-call' && ['agent_teams_approve', 'agent_teams_status'].includes(x.name)), oneUserMessageAndHttpApproval: trace.filter(x => x.event === 'web-driver-user-message').length === 1 && trace.filter(x => x.event === 'web-http-approval-start').length === 1, invalidTeamRejected: Boolean(invalid?.status === 404 && approved && invalid.order < approved.order), repeatApprovalRejected: Boolean(repeated?.status === 409 && yielded && released && yielded.order < repeated.order && repeated.order < released.order), stableCaptainHeaders: Boolean(stable?.systemSha256 && stable?.toolsSha256), memberFourTools: stable?.memberTeamToolCount === 4 && stable.memberRequests > 0, taskCompleted: evidence?.taskStatus === 'completed' };
        runs.push({ scenario, passed: Object.values(assertions).every(Boolean), assertions, evidence, exit: { code: result.code, signal: result.signal, timedOut: result.timedOut } });
        continue;
    }
    const statePath = join(workspace, '.agent-teams/runtime-lab/team.json'), state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : undefined;
    const requests = trace.filter(x => x.event === 'request' && x.purpose === undefined), memberRequests = requests.filter(x => x.isMember);
    const isFailure = scenario === 'failure';
    const memberToolsRestricted = rows => rows.length > 0 && rows.every(x => !x.toolNames.includes('agent_teams_create') && x.toolNames.includes('agent_teams_claim_task'));
    const assertions = { exit0: result.code === 0 && !result.timedOut, productMarker: result.stdout.includes(isFailure ? 'AGENTTEAMS_EXPECTED_FAILURE_OK' : scenario === 'captain-idle-wakeup' ? 'CAPTAIN_IDLE_WAKEUP_OK' : 'AGENTTEAMS_PRODUCT_TURN_OK'), pluginToolsVisible: requests.some(x => x.toolNames.includes('agent_teams_create')), memberExecuted: memberRequests.length > 0, memberToolsRestricted: memberToolsRestricted(memberRequests), explicitReasoning: memberRequests.length > 0 && memberRequests.some(x => x.model !== 'fixture-fallback') && memberRequests.filter(x => x.model !== 'fixture-fallback').every(x => x.reasoningEffort === 'high'), taskTerminal: state?.tasks?.find(t => t.id === 't1')?.status === (isFailure ? 'failed' : 'completed') };
    if (!isFailure && scenario !== 'captain-idle-wakeup')
        assertions.secondWake = memberRequests.some(x => x.userText.includes('SECOND_WAKE_FIXTURE'));
    if (scenario === 'captain-idle-wakeup') {
        const idle = trace.find(x => x.event === 'captain-idle-observed');
        const notified = trace.find(x => x.event === 'captain-notified-after-yield');
        assertions.captainActuallyYielded = idle?.status === 'idle';
        assertions.notifiedAfterIdle = Boolean(idle && notified && idle.time < notified.time && idle.sessionId === notified.sessionId);
    }
    if (scenario === 'lifecycle') {
        const withBoth = memberRequests.find(x => x.userText.includes('FIFO_FIRST') && x.userText.includes('FIFO_SECOND'));
        assertions.fifoMessageOrder = Boolean(withBoth && withBoth.userText.indexOf('FIFO_FIRST') < withBoth.userText.indexOf('FIFO_SECOND'));
        const firstMember = memberRequests[0], firstResponse = trace.find(x => x.event === 'response' && x.isMember);
        const busySend = trace.find(x => x.event === 'request' && !x.isMember && x.called.includes('agent_teams_send_message'));
        assertions.messagesSentWhileBusy = Boolean(firstMember && firstResponse && busySend && firstMember.time <= busySend.time && busySend.time < firstResponse.time);
    }
    if (scenario === 'fallback') {
        assertions.fallbackActivated = memberRequests.some(x => x.model === 'fixture-fallback') && state?.members?.some(m => m.fallbackActive && m.activeModel === 'fixture-fallback');
        assertions.fallbackReasoningReset = memberRequests.some(x => x.model === 'fixture-fallback') && memberRequests.filter(x => x.model === 'fixture-fallback').every(x => x.reasoningEffort === 'low');
    }
    const passed = Object.values(assertions).every(Boolean);
    runs.push({ scenario, passed, exit: { code: result.code, signal: result.signal, timedOut: result.timedOut }, assertions, requests: requests.length, memberRequests: memberRequests.length });
    if (state)
        json(join(report, scenario, 'team-evidence.json'), state);
    if (passed && !isFailure && scenario !== 'captain-idle-wakeup') {
        copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-resume.mjs'), join(profile, 'fixture-resume.mjs'));
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + '- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- insert:\n    - id: runtime-lab-cold-resume\n      name: ./fixture-resume.mjs\n');
        const coldTrace = join(report, scenario, 'cold-trace.jsonl');
        const cold = await command([process.execPath, join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'headless'], workspace, environment({ DSH_HOME: home, DSH_PERMISSION_MODE: 'danger-full-access', DSH_TELEMETRY_DISABLED: '1', LAB_TRACE: coldTrace, LAB_TEAMS: '1', LAB_COLD: '1', LAB_SCENARIO: scenario, LAB_PARENT_SESSION: state.captainSessionId }), scenario + '-cold', 90000);
        const coldEvents = existsSync(coldTrace) ? readFileSync(coldTrace, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
        const coldMember = coldEvents.find(x => x.event === 'cold-member-completed');
        const coldAssertions = { memberToolsRestricted: memberToolsRestricted(coldEvents.filter(x => x.event === 'request' && x.isMember && x.purpose === undefined)), exit0: cold.code === 0 && !cold.timedOut, driverCompleted: cold.stdout.includes('COLD_RESTORE_DRIVER_DONE'), sameMemberRestored: coldMember?.sessionId === state.members.find(m => m.name === 'worker')?.id, routeRestored: coldMember?.model === (scenario === 'fallback' ? 'fixture-fallback' : 'fixture-model'), reasoningRestored: coldMember?.reasoningEffort === (scenario === 'fallback' ? 'low' : 'high') };
        runs.push({ scenario: scenario + '-cold-restore', passed: Object.values(coldAssertions).every(Boolean), assertions: coldAssertions, exit: { code: cold.code, signal: cold.signal, timedOut: cold.timedOut } });
    }
}
return runs;
}
