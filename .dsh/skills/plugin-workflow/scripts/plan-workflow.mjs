#!/usr/bin/env node
import { readFile, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const selectionSchema = JSON.parse(
  readFileSync(new URL('../references/workflow-selection.schema.json', import.meta.url), 'utf8'),
)

export const SELECTION_SCHEMA_VERSION = selectionSchema.properties.schemaVersion.const
export const WORKFLOW_IDS = Object.freeze([...selectionSchema.properties.workflow.enum])
export const CAPABILITY_IDS = Object.freeze([...selectionSchema.$defs.capability.enum])
export const SURFACE_IDS = Object.freeze([...selectionSchema.properties.surfaces.items.enum])
export const PLUGIN_STATES = Object.freeze([...selectionSchema.properties.pluginState.enum])

const WORKFLOWS = {
  'health-check': {
    outcome: 'Read-only plugin and upgrade-risk report',
    defaults: ['touchpoint-scan'],
  },
  'upgrade-target': {
    outcome: 'Upgrade an installed plugin to an explicit version',
    defaults: ['static-tests', 'rollback'],
    core: { capability: 'upgrade-installed', owner: 'plugin-upgrade', confirmations: ['repository-writes', 'dependency-runtime'] },
  },
  'compatibility-migration': {
    outcome: 'Adapt plugin source to an exact DSH target',
    defaults: ['dsh-audit', 'touchpoint-scan', 'static-tests', 'docker-smoke', 'functional-probe', 'rollback'],
    core: { capability: 'source-migration', owner: 'plugin-upgrade', confirmations: ['repository-writes'] },
  },
  'test-only': {
    outcome: 'Validate an existing source tree or artifact',
    defaults: ['static-tests'],
  },
  'naming-registry': {
    outcome: 'Validate identifiers and optionally check or register a cloud ID',
    defaults: ['naming-local'],
  },
  'package-release': {
    outcome: 'Prepare and optionally publish a release',
    defaults: ['static-tests', 'docker-smoke', 'functional-probe', 'rollback', 'package-artifact'],
  },
  'full-lifecycle': {
    outcome: 'Migrate, validate, name, package, and optionally publish',
    defaults: ['dsh-audit', 'touchpoint-scan', 'static-tests', 'docker-smoke', 'functional-probe', 'rollback', 'package-artifact'],
    core: { capability: 'source-migration', owner: 'plugin-upgrade', confirmations: ['repository-writes'] },
  },
  'runtime-debug': {
    outcome: 'Diagnose and fix Web Client runtime behavior',
    defaults: ['runtime-debug'],
    required: ['runtime-debug'],
  },
  'heavy-dependency': {
    outcome: 'Integrate and verify a lazy-loaded Web Client dependency',
    defaults: ['heavy-dependency'],
    required: ['heavy-dependency'],
  },
}

const CAPABILITIES = {
  'runtime-debug': {
    description: 'Diagnose and fix Web Client host-contract mismatches',
    owner: 'plugin-runtime-debug',
    confirmations: ['repository-writes', 'dependency-runtime'],
    requires: ['static-tests', 'functional-probe', 'browser-check', 'rollback'],
    surface: 'web-client',
  },
  'heavy-dependency': {
    description: 'Integrate a lazy-loaded browser dependency and its fallback',
    owner: 'plugin-heavy-dep',
    confirmations: ['repository-writes', 'dependency-runtime'],
    requires: ['static-tests', 'functional-probe', 'browser-check', 'rollback', 'package-artifact'],
    surface: 'web-client',
  },
  'dsh-audit': { description: 'DSH version compatibility audit', owner: 'dsh-upgrade-audit', confirmations: [] },
  'touchpoint-scan': { description: 'Seven-touchpoint plugin scan', owner: 'plugin-upgrade', confirmations: [] },
  'naming-local': { description: 'Offline naming declaration validation', owner: 'plugin-write', confirmations: [] },
  'registry-query': { description: 'Central cloud registry lookup', owner: 'plugin-write', confirmations: [], requires: ['naming-local'] },
  'static-tests': { description: 'Typecheck, unit tests, and build', owner: 'plugin-test', confirmations: ['dependency-runtime'] },
  'docker-smoke': { description: 'Exact-version Docker cold start', owner: 'plugin-test', confirmations: ['dependency-runtime'] },
  'functional-probe': { description: 'One real functional path', owner: 'plugin-test', confirmations: ['dependency-runtime'] },
  'browser-check': { description: 'Browser validation for Web Client surfaces', owner: 'plugin-test', confirmations: ['dependency-runtime'] },
  rollback: { description: 'Rollback rehearsal or recipe', owner: 'plugin-upgrade', confirmations: [] },
  'package-artifact': { description: 'Build and inspect a package artifact', owner: 'plugin-release', confirmations: ['dependency-runtime'], requires: ['static-tests'] },
  'registry-register': { description: 'Central cloud ID registration', owner: 'plugin-write', confirmations: ['external-publication'], requires: ['registry-query'] },
  release: {
    description: 'Publish an artifact or release',
    owner: 'plugin-release',
    confirmations: ['external-publication'],
    requires: ['package-artifact', 'functional-probe', 'rollback'],
  },
}

for (const id of CAPABILITY_IDS) {
  if (!CAPABILITIES[id]) throw new Error(`selection schema capability has no planner definition: ${id}`)
}
for (const id of Object.keys(CAPABILITIES)) {
  if (!CAPABILITY_IDS.includes(id)) throw new Error(`planner capability is missing from selection schema: ${id}`)
}

const PHASE_ORDER = [
  'dsh-audit',
  'touchpoint-scan',
  'core',
  'runtime-debug',
  'heavy-dependency',
  'naming-local',
  'registry-query',
  'static-tests',
  'docker-smoke',
  'functional-probe',
  'browser-check',
  'rollback',
  'package-artifact',
  'registry-register',
  'release',
]

const BOUNDARY_LABELS = {
  'repository-writes': 'Repository writes',
  'dependency-runtime': 'Dependency and runtime execution',
  'external-publication': 'External publication',
}

function assertPlainObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
}

function validateEnum(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`)
}

function validateUniqueEnumArray(value, allowed, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  if (new Set(value).size !== value.length) throw new Error(`${name} must not contain duplicates`)
  for (const item of value) validateEnum(item, allowed, `${name} item`)
  return [...value]
}

export function validateSelection(input) {
  assertPlainObject(input, 'selection')
  const allowedKeys = new Set(['schemaVersion', 'workflow', 'include', 'exclude', 'surfaces', 'pluginState'])
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) throw new Error(`selection contains unknown property: ${key}`)
  }

  if (input.schemaVersion !== SELECTION_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${SELECTION_SCHEMA_VERSION}`)
  }
  validateEnum(input.workflow, WORKFLOW_IDS, 'workflow')
  const include = validateUniqueEnumArray(input.include ?? [], CAPABILITY_IDS, 'include')
  const exclude = validateUniqueEnumArray(input.exclude ?? [], CAPABILITY_IDS, 'exclude')
  const surfaces = validateUniqueEnumArray(input.surfaces ?? ['ordinary-plugin'], SURFACE_IDS, 'surfaces')
  if (surfaces.length === 0) throw new Error('surfaces must contain at least one item')
  const pluginState = input.pluginState ?? 'existing'
  validateEnum(pluginState, PLUGIN_STATES, 'pluginState')

  const conflicts = include.filter((id) => exclude.includes(id))
  if (conflicts.length) throw new Error(`capabilities cannot be both included and excluded: ${conflicts.join(', ')}`)

  return {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    workflow: input.workflow,
    include,
    exclude,
    surfaces,
    pluginState,
  }
}

function chooseCapabilities(selection) {
  const selected = new Map()
  const excluded = new Set(selection.exclude)
  for (const id of WORKFLOWS[selection.workflow].required ?? []) {
    if (excluded.has(id)) throw new Error(`${selection.workflow} requires excluded capability ${id}`)
  }
  const select = (id, source) => {
    if (!excluded.has(id) && !selected.has(id)) selected.set(id, source)
  }

  for (const id of WORKFLOWS[selection.workflow].defaults) select(id, 'workflow-default')
  if (selection.surfaces.includes('web-client') && ['compatibility-migration', 'package-release', 'full-lifecycle'].includes(selection.workflow)) {
    select('browser-check', 'surface-default')
  }
  if (selection.pluginState === 'new' && ['naming-registry', 'full-lifecycle'].includes(selection.workflow)) {
    select('naming-local', 'plugin-state-default')
  }
  for (const id of selection.include) select(id, 'user-include')

  const enableDependencies = (id, chain = []) => {
    for (const dependency of CAPABILITIES[id].requires ?? []) {
      if (excluded.has(dependency)) {
        throw new Error(`${id} requires excluded capability ${dependency}`)
      }
      if (!selected.has(dependency)) selected.set(dependency, `required-by:${id}`)
      if (chain.includes(dependency)) throw new Error(`capability dependency cycle: ${[...chain, dependency].join(' -> ')}`)
      enableDependencies(dependency, [...chain, id])
    }
  }
  for (const id of [...selected.keys()]) enableDependencies(id)

  for (const id of selected.keys()) {
    const surface = CAPABILITIES[id].surface
    if (surface && !selection.surfaces.includes(surface)) throw new Error(`${id} requires surface ${surface}`)
  }

  return selected
}

function resolveCore(selection) {
  const base = WORKFLOWS[selection.workflow].core
  if (!base) return undefined
  if (selection.workflow === 'full-lifecycle' && selection.pluginState === 'new') {
    return { capability: 'plugin-implementation', owner: 'plugin-write', confirmations: ['repository-writes'] }
  }
  return base
}

function capabilityPhase(id, selection) {
  const definition = CAPABILITIES[id]
  let owner = definition.owner
  let confirmations = [...definition.confirmations]
  if (id === 'naming-local' && selection.pluginState === 'new') confirmations = ['repository-writes']
  if (id === 'rollback' && ['package-release', 'full-lifecycle'].includes(selection.workflow)) owner = 'plugin-release'
  return { capability: id, owner, confirmations }
}

export function buildWorkflowPlan(input) {
  const selection = validateSelection(input)
  const chosen = chooseCapabilities(selection)
  const core = resolveCore(selection)
  const rawPhases = [
    { capability: 'discovery', owner: 'plugin-workflow', confirmations: [] },
  ]

  for (const slot of PHASE_ORDER) {
    if (slot === 'core') {
      if (core) rawPhases.push(core)
      continue
    }
    if (chosen.has(slot)) rawPhases.push(capabilityPhase(slot, selection))
  }

  const ledger = rawPhases.map((phase, index) => ({
    phase: `P${String(index + 1).padStart(2, '0')}`,
    capability: phase.capability,
    owner: phase.owner,
    status: 'selected',
    confirmations: phase.confirmations,
    evidence: null,
  }))

  const confirmations = Object.keys(BOUNDARY_LABELS).flatMap((boundary) => {
    const phases = ledger.filter((phase) => phase.confirmations.includes(boundary)).map((phase) => phase.phase)
    return phases.length ? [{ boundary, label: BOUNDARY_LABELS[boundary], phases, granted: false }] : []
  })

  return {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    readOnly: true,
    selection,
    capabilities: CAPABILITY_IDS.map((id) => ({
      id,
      selected: chosen.has(id),
      source: chosen.get(id) ?? (selection.exclude.includes(id) ? 'user-exclude' : 'not-selected'),
    })),
    ledger,
    confirmations,
    notes: [
      'This plan is read-only and does not grant execution approval.',
      'Load each owning Skill before executing its phase.',
      'Check authorization against the user request and higher-priority instructions; reuse existing authorization for the same scope.',
    ],
  }
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|')
}

export function buildWorkflowMenu() {
  return {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    readOnly: true,
    requiresSelection: true,
    recommendedWorkflow: 'health-check',
    workflows: WORKFLOW_IDS.map((id, index) => ({
      choice: index + 1,
      id,
      outcome: WORKFLOWS[id].outcome,
      defaultCapabilities: [...WORKFLOWS[id].defaults],
    })),
    capabilities: CAPABILITY_IDS.map((id) => ({
      id,
      description: CAPABILITIES[id].description,
      owner: CAPABILITIES[id].owner,
      confirmations: [...CAPABILITIES[id].confirmations],
      defaultFor: WORKFLOW_IDS.filter((workflow) => WORKFLOWS[workflow].defaults.includes(id)),
    })),
    replyExamples: [
      'health-check',
      '3 + docker-smoke + browser-check',
      'compatibility-migration, exclude browser-check',
    ],
  }
}

export function renderMenuMarkdown(menu = buildWorkflowMenu()) {
  const lines = [
    '# DSH plugin workflow menu (read-only)',
    '',
    'No workflow has been selected. Choose one workflow and optionally add or remove capabilities.',
    '',
    '## Workflows',
    '',
    '| Choice | Workflow | Outcome | Default capabilities |',
    '|---:|---|---|---|',
  ]
  for (const workflow of menu.workflows) {
    const recommendation = workflow.id === menu.recommendedWorkflow ? ' (recommended for first run)' : ''
    const defaults = workflow.defaultCapabilities.map((id) => `\`${id}\``).join(', ') || 'none'
    lines.push(`| ${workflow.choice} | \`${escapeCell(workflow.id)}\`${recommendation} | ${escapeCell(workflow.outcome)} | ${defaults} |`)
  }

  lines.push(
    '',
    '## Optional capabilities',
    '',
    '| Capability | Purpose | Owner | Later confirmation |',
    '|---|---|---|---|',
  )
  for (const capability of menu.capabilities) {
    const confirmations = capability.confirmations.map((id) => BOUNDARY_LABELS[id]).join(', ') || 'none (read-only)'
    lines.push(`| \`${escapeCell(capability.id)}\` | ${escapeCell(capability.description)} | \`$${escapeCell(capability.owner)}\` | ${escapeCell(confirmations)} |`)
  }

  lines.push(
    '',
    '## Reply with a selection',
    '',
    ...menu.replyExamples.map((example) => `- \`${example}\``),
    '',
    'Showing this menu is read-only. No discovery, install, test, repository write, or publication has started.',
  )
  return `${lines.join('\n')}\n`
}

export function renderMarkdown(plan) {
  const selected = plan.capabilities.filter((entry) => entry.selected)
  const excluded = plan.capabilities.filter((entry) => entry.source === 'user-exclude')
  const lines = [
    '# DSH plugin workflow plan (read-only)',
    '',
    `- Workflow: \`${plan.selection.workflow}\``,
    `- Plugin state: \`${plan.selection.pluginState}\``,
    `- Surfaces: ${plan.selection.surfaces.map((item) => `\`${item}\``).join(', ')}`,
    `- Selected capabilities: ${selected.length ? selected.map((item) => `\`${item.id}\``).join(', ') : 'none'}`,
    `- Explicitly excluded: ${excluded.length ? excluded.map((item) => `\`${item.id}\``).join(', ') : 'none'}`,
    '- Planning is read-only and does not grant execution approval.',
    '',
    '## Phase ledger',
    '',
    '| Phase | Capability | Owner | Status | Confirmation |',
    '|---|---|---|---|---|',
  ]
  for (const phase of plan.ledger) {
    lines.push(`| ${phase.phase} | \`${escapeCell(phase.capability)}\` | \`$${escapeCell(phase.owner)}\` | \`${phase.status}\` | ${phase.confirmations.map((item) => `\`${item}\``).join(', ') || 'none'} |`)
  }

  lines.push('', '## Confirmation boundaries', '')
  if (!plan.confirmations.length) lines.push('- None. The selected workflow is read-only.')
  for (const confirmation of plan.confirmations) {
    lines.push(`- **${confirmation.label}**: ${confirmation.phases.join(', ')}; not granted.`)
  }
  lines.push('', '## Notes', '', ...plan.notes.map((note) => `- ${note}`))
  return `${lines.join('\n')}\n`
}

function splitList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function usage() {
  return `Usage:\n  node skills/plugin-workflow/scripts/plan-workflow.mjs [--menu] [--format markdown|json]\n  node skills/plugin-workflow/scripts/plan-workflow.mjs --workflow <id> [--include a,b] [--exclude a,b] [--surface a,b] [--plugin-state existing|new] [--format markdown|json]\n  node skills/plugin-workflow/scripts/plan-workflow.mjs --selection <selection.json> [--format markdown|json]\n\nWith no selection, the command prints the pre-run menu. It is read-only and never executes a selected phase.\n`
}

function parseArgs(argv) {
  const options = { format: 'markdown' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--menu') {
      options.menu = true
      continue
    }
    const value = argv[++index]
    if (value === undefined) throw new Error(`missing value for ${arg}`)
    if (arg === '--workflow') options.workflow = value
    else if (arg === '--include') options.include = splitList(value)
    else if (arg === '--exclude') options.exclude = splitList(value)
    else if (arg === '--surface') options.surfaces = splitList(value)
    else if (arg === '--plugin-state') options.pluginState = value
    else if (arg === '--selection') options.selectionPath = value
    else if (arg === '--format') options.format = value
    else throw new Error(`unknown option: ${arg}`)
  }
  if (!['json', 'markdown'].includes(options.format)) throw new Error('--format must be markdown or json')
  const hasInlineSelection = ['workflow', 'include', 'exclude', 'surfaces', 'pluginState'].some((key) => options[key] !== undefined)
  if (options.menu && (options.selectionPath || hasInlineSelection)) {
    throw new Error('--menu cannot be combined with a workflow selection')
  }
  if (options.selectionPath && ['workflow', 'include', 'exclude', 'surfaces', 'pluginState'].some((key) => options[key] !== undefined)) {
    throw new Error('--selection cannot be combined with inline selection options')
  }
  return options
}

async function loadInput(options) {
  if (options.selectionPath) return JSON.parse(await new Promise((accept, reject) => readFile(resolve(options.selectionPath), 'utf8', (error, data) => error ? reject(error) : accept(data))))
  if (!options.workflow) throw new Error('select a workflow with --workflow before creating a plan')
  return {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    workflow: options.workflow,
    include: options.include ?? [],
    exclude: options.exclude ?? [],
    surfaces: options.surfaces ?? ['ordinary-plugin'],
    pluginState: options.pluginState ?? 'existing',
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage())
    } else {
      const hasSelectionDetails = ['include', 'exclude', 'surfaces', 'pluginState'].some((key) => options[key] !== undefined)
      if (!options.menu && !options.selectionPath && !options.workflow && hasSelectionDetails) {
        throw new Error('select a workflow with --workflow before adding selection details')
      }
      const hasSelection = options.selectionPath || options.workflow
      if (options.menu || !hasSelection) {
        const menu = buildWorkflowMenu()
        process.stdout.write(options.format === 'json' ? `${JSON.stringify(menu, null, 2)}\n` : renderMenuMarkdown(menu))
      } else {
        const plan = buildWorkflowPlan(await loadInput(options))
        process.stdout.write(options.format === 'json' ? `${JSON.stringify(plan, null, 2)}\n` : renderMarkdown(plan))
      }
    }
  } catch (error) {
    process.stderr.write(`plan-workflow: ${error.message}\n${usage()}`)
    process.exitCode = 1
  }
}
