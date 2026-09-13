/** Diagnostic probe for exact installed Harness 0.1.5-rc.1 internals.
 * This is a boundary test with fixture Agents, not a CLI/LLM end-to-end test.
 * Copies bundles to a disposable directory and exposes private classes there;
 * original bundles, user sessions, profiles, and provider credentials are untouched.
 * Usage: node host-boundary-probe.mjs <dsh package directory> <plugin package directory>
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [hostArgument, pluginArgument] = process.argv.slice(2);
assert.ok(hostArgument && pluginArgument, 'Supply exact installed Harness and plugin directories');
const host = resolve(hostArgument), plugin = resolve(pluginArgument);
const dependencies = join(host, 'node_modules');
const hostPackage = JSON.parse(await readFile(join(host, 'package.json'), 'utf8'));
assert.equal(hostPackage.version, '0.1.5-rc.1');
const temporary = await mkdtemp(join(tmpdir(), 'agentteams-boundary-'));
const observations = [];
try {
  await symlink(dependencies, join(temporary, 'node_modules'), 'dir');
  async function expose(name, names) {
    const directory = join(dependencies, '@deepseek-ai', name);
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(metadata.version, '0.1.5-rc.1');
    const source = await readFile(join(directory, 'lib/index.js'), 'utf8');
    observations.push({ package: name, version: metadata.version,
      sha256: createHash('sha256').update(source).digest('hex') });
    const file = join(temporary, `${name}.mjs`);
    await writeFile(file, source + `\nexport { ${names.join(', ')} };\n`);
    return import(pathToFileURL(file));
  }
  const { SubagentInbox, ContinuableActivationRegistry } = await expose(
    'dsh-subagent', ['SubagentInbox', 'ContinuableActivationRegistry']);
  const { ReactLoopAgent } = await expose('dsh-agent-loop', ['ReactLoopAgent']);
  const { queueMemberPrompt, guardSubagentDelivery } = await import(
    pathToFileURL(join(plugin, 'lib/harness-compat.js')));
  const { describeQualityLoop, canDeclareDelivery } = await import(
    pathToFileURL(join(plugin, 'lib/quality-gates.js')));
  const pendingTeam = { tasks: [{ id: 't1', kind: 'work', status: 'pending', dependencies: [] }] };
  assert.equal(canDeclareDelivery(pendingTeam).ok, true);
  assert.equal(describeQualityLoop(pendingTeam).deliverable, true);
  observations.push({ check: 'installed plugin declares delivery while ordinary work remains pending', passed: true });

  // Native Agent inbox-routing and cancellation methods; no model driver starts.
  function agent(id, parent) {
    const fixture = Object.create(ReactLoopAgent.prototype);
    const nextTurn = [], nextStep = [];
    Object.assign(fixture, {
      id, session: { header: { parentSession: parent } },
      phase: { kind: 'running', turn: 1, step: 1, abort: new AbortController(), wakeRequested: false },
      activityDone: Promise.resolve(),
      dispatch: { emit() {} },
      ctx: { sessions: { async flush() {} } },
      wakes: 0,
      wakeDriver() { this.wakes++; },
      inbox: {
        nextTurn, nextStep,
        splice(target, start, count, items) {
          return (target === 'next-turn' ? nextTurn : nextStep).splice(start, count, ...items);
        },
        clear() { nextTurn.length = 0; nextStep.length = 0; },
      },
    });
    return fixture;
  }
  const captain = agent('captain');
  const member = agent('member', captain.id);
  const grandchild = agent('grandchild', member.id);
  const unrelated = agent('unrelated', captain.id);
  const agents = new Map([captain, member, grandchild, unrelated].map(value => [value.id, value]));
  function activation(child, parent, ancestry) {
    return {
      childId: child.id, parentSession: parent.id, ancestry: new Set(ancestry),
      handle: { agent: child, async dispose() { agents.delete(child.id); } },
      inbox: new SubagentInbox(child), ownedChildren: new Set(),
      poke: Promise.withResolvers(), announced: false,
      observer: { capture() {}, terminal() { return { stopReason: 'completed' }; }, settle() {} },
    };
  }
  const memberActivation = activation(member, captain, [captain]);
  const childActivation = activation(grandchild, member, [captain, member]);
  const unrelatedActivation = activation(unrelated, captain, [captain]);
  memberActivation.ownedChildren.add(grandchild.id);
  // No service lifecycle needed for these synchronous / selected-drain methods.
  const registry = Object.create(ContinuableActivationRegistry.prototype);
  Object.assign(registry, {
    ctx: { agents: { get: id => agents.get(id) }, logger: { warn() {} } },
    resident: new Map([memberActivation, childActivation, unrelatedActivation].map(value => [value.childId, value])),
    closingScopes: new Map(), draining: false,
  });
  const deliverKey = Symbol.for('dsh.subagent.deliverPrompt');
  const runtime = {
    async [deliverKey](_parent, id, content, source, _signal, delivery) {
      registry.get(id).inbox.deliver({ id: 'guidance', content, source }, delivery);
      return 'guidance';
    },
    async sendMessage() { return 'accepted'; },
  };
  const retired = new Set();
  let disposeGuard;
  guardSubagentDelivery({ subagents: runtime, effect(setup) { disposeGuard = setup(); } },
    async (_parent, id) => retired.has(id));
  const content = [{ type: 'text', text: 'Correct the scope of the current task' }];
  await queueMemberPrompt(runtime, captain, member.id, content, new AbortController().signal);
  assert.equal(member.inbox.nextTurn.length, 1);
  assert.equal(member.inbox.nextStep.length, 0);
  observations.push({ check: 'installed plugin queues current-task guidance into next-turn', passed: true });

  retired.add(member.id);
  await assert.rejects(queueMemberPrompt(runtime, captain, member.id, content, new AbortController().signal),
    { code: 'NOT_RESUMABLE' });
  registry.interrupt(member.id, { kind: 'ancestor', agent: captain });
  assert.equal(member.phase.abort.signal.aborted, true);
  assert.equal(member.inbox.nextTurn.length, 1);
  assert.equal(grandchild.phase.abort.signal.aborted, false);
  observations.push({ check: 'native interrupt preserves queued input and does not stop grandchild', passed: true });

  // The direct member has become idle, as waitForMemberIdle in delete observes.
  member.phase = { kind: 'idle', lastTurn: 1 };
  const beforeNotice = member.wakes;
  registry.notifySettlement({ ...childActivation, announced: true }, { stopReason: 'completed' });
  assert.equal(member.wakes, beforeNotice + 1);
  assert.equal(member.inbox.nextTurn.length, 2);
  observations.push({ check: 'native child settlement wakes retired parent behind public delivery guard', passed: true });

  await registry.drainChildren(captain, [member.id]);
  assert.equal(registry.resident.has(member.id), false);
  assert.equal(registry.resident.has(grandchild.id), false);
  assert.equal(member.inbox.nextTurn.length, 0);
  assert.equal(grandchild.phase.abort.signal.aborted, true);
  assert.equal(registry.resident.has(unrelated.id), true);
  assert.equal(unrelated.phase.abort.signal.aborted, false);
  observations.push({ check: 'native selected drain clears inbox and recursively disposes owned children, preserving sibling', passed: true });
  disposeGuard();
  console.log(JSON.stringify({ hostVersion: hostPackage.version, observations }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
