import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'src', 'index.ts'), 'utf8');
const docs = await fs.readFile(path.join(root, 'docs', 'usage.md'), 'utf8');
const start = source.indexOf('export function usageSectionText');
const end = source.indexOf('\nexport function apply', start);
if (start < 0 || end < 0) throw new Error('Captain usage prompt could not be located');
const prompt = source.slice(start, end);
const required = [
  ['project mode selection', 'PROJECT MODE SELECTION'],
  ['legacy branch', 'LEGACY AGENTTEAMS MODE'],
  ['project initialization', 'agent_project_init'],
  ['project status/report inspection', 'agent_project_status'],
  ['Greenfield/Brownfield discovery', 'Greenfield/Brownfield'],
  ['clarification', 'agent_project_clarification'],
  ['requirements', 'agent_project_requirement_update'],
  ['design', 'agent_project_design_update'],
  ['implementation gate', 'agent_project_gate(action=\"assert_implementation_allowed\")'],
  ['Work Item synchronization', 'agent_project_work_item_sync'],
  ['implemented but not accepted state', 'implemented_not_accepted'],
  ['acceptance action', "agent_project_work_item_accept(action='accept')"],
  ['delivery action', "agent_project_work_item_accept(action='deliver')"],
  ['explicit confirmation', 'explicit user confirmation'],
  ['stop conditions', 'Stop and'],
  ['prompt boundary', 'not a security boundary']
];
const missing = required.filter(([, needle]) => !prompt.includes(needle));
if (missing.length > 0) throw new Error('Captain project-flow protocol is missing: ' + missing.map(([label, needle]) => label + ' (' + needle + ')').join(', '));
const order = ['agent_project_init', 'agent_project_clarification', 'agent_project_requirement_update', 'agent_project_design_update', 'agent_project_gate', 'agent_project_work_item_update', 'agent_project_work_item_sync', 'agent_project_work_item_accept'];
let previous = -1;
for (const needle of order) {
  const index = prompt.indexOf(needle);
  if (index < 0 || index < previous) throw new Error('Captain project-flow order is invalid at ' + needle);
  previous = index;
}
for (const needle of ['protocol-driven workflow', 'not an autonomous lifecycle controller', 'not a security boundary', 'Legacy AgentTeams mode']) {
  if (!docs.toLowerCase().includes(needle.toLowerCase())) throw new Error('Usage documentation is missing scope statement: ' + needle);
}
console.log('captain-project-flow-verify: ' + required.length + ' protocol assertions passed');

