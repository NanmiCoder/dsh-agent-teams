import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CAPABILITY_IDS,
  SELECTION_SCHEMA_VERSION,
  WORKFLOW_IDS,
  buildWorkflowMenu,
  buildWorkflowPlan,
  renderMenuMarkdown,
  renderMarkdown,
  validateSelection,
} from './plan-workflow.mjs'

const script = fileURLToPath(new URL('./plan-workflow.mjs', import.meta.url))
const schemaPath = fileURLToPath(new URL('../references/workflow-selection.schema.json', import.meta.url))

function selection(overrides = {}) {
  return {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    workflow: 'health-check',
    include: [],
    exclude: [],
    surfaces: ['ordinary-plugin'],
    pluginState: 'existing',
    ...overrides,
  }
}

function runCli(args) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => accept({ code, stdout, stderr }))
  })
}

export async function runWorkflowPlannerChecks() {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
  assert.deepEqual(WORKFLOW_IDS, schema.properties.workflow.enum)
  assert.deepEqual(CAPABILITY_IDS, schema.$defs.capability.enum)

  const menu = buildWorkflowMenu()
  assert.equal(menu.readOnly, true)
  assert.equal(menu.requiresSelection, true)
  assert.equal(menu.recommendedWorkflow, 'health-check')
  assert.deepEqual(menu.workflows.map((workflow) => workflow.id), WORKFLOW_IDS)
  assert.deepEqual(menu.capabilities.map((capability) => capability.id), CAPABILITY_IDS)
  const menuMarkdown = renderMenuMarkdown(menu)
  assert.match(menuMarkdown, /workflow menu \(read-only\)/)
  assert.match(menuMarkdown, /recommended for first run/)
  assert.match(menuMarkdown, /No discovery, install, test, repository write, or publication has started/)

  const health = buildWorkflowPlan(selection())
  assert.equal(health.readOnly, true)
  assert.deepEqual(health.ledger.map((phase) => phase.capability), ['discovery', 'touchpoint-scan'])
  assert.equal(health.confirmations.length, 0)

  const migration = buildWorkflowPlan(selection({
    workflow: 'compatibility-migration',
    surfaces: ['web-client'],
  }))
  assert.deepEqual(migration.ledger.map((phase) => phase.capability), [
    'discovery',
    'dsh-audit',
    'touchpoint-scan',
    'source-migration',
    'static-tests',
    'docker-smoke',
    'functional-probe',
    'browser-check',
    'rollback',
  ])
  assert(migration.confirmations.some((entry) => entry.boundary === 'repository-writes'))
  assert(migration.confirmations.some((entry) => entry.boundary === 'dependency-runtime'))
  assert(!migration.confirmations.some((entry) => entry.boundary === 'external-publication'))

  const registration = buildWorkflowPlan(selection({
    workflow: 'naming-registry',
    include: ['registry-register'],
  }))
  const registrationCapabilities = new Map(registration.capabilities.map((entry) => [entry.id, entry]))
  assert.equal(registrationCapabilities.get('registry-register').source, 'user-include')
  assert.equal(registrationCapabilities.get('registry-query').source, 'required-by:registry-register')
  assert(registration.confirmations.some((entry) => entry.boundary === 'external-publication'))

  const newPlugin = buildWorkflowPlan(selection({ workflow: 'full-lifecycle', pluginState: 'new' }))
  assert(newPlugin.ledger.some((phase) => phase.capability === 'plugin-implementation' && phase.owner === 'plugin-write'))
  assert(newPlugin.ledger.some((phase) => phase.capability === 'naming-local' && phase.confirmations.includes('repository-writes')))

  assert.throws(
    () => buildWorkflowPlan(selection({ workflow: 'package-release', include: ['release'], exclude: ['functional-probe'] })),
    /release requires excluded capability functional-probe/,
  )
  assert.throws(
    () => validateSelection(selection({ include: ['registry-query'], exclude: ['registry-query'] })),
    /both included and excluded/,
  )
  assert.throws(() => validateSelection(selection({ workflow: 'unknown' })), /workflow must be one of/)
  assert.throws(() => validateSelection({ ...selection(), extra: true }), /unknown property/)

  const markdown = renderMarkdown(migration)
  assert.match(markdown, /workflow plan \(read-only\)/)
  assert.match(markdown, /does not grant execution approval/)
  assert.doesNotMatch(markdown, /External publication/)
  const releaseMarkdown = renderMarkdown(buildWorkflowPlan(selection({
    workflow: 'package-release',
    include: ['release'],
  })))
  assert.match(releaseMarkdown, /External publication/)

  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-workflow-plan-'))
  try {
    const noArgs = await runCli([])
    assert.equal(noArgs.code, 0, noArgs.stderr)
    assert.match(noArgs.stdout, /workflow menu \(read-only\)/)
    assert.doesNotMatch(noArgs.stdout, /Phase ledger/)

    const menuJson = await runCli(['--menu', '--format', 'json'])
    assert.equal(menuJson.code, 0, menuJson.stderr)
    assert.equal(JSON.parse(menuJson.stdout).requiresSelection, true)

    const explicitHealth = await runCli(['--workflow', 'health-check', '--format', 'json'])
    assert.equal(explicitHealth.code, 0, explicitHealth.stderr)
    assert.deepEqual(JSON.parse(explicitHealth.stdout).ledger.map((phase) => phase.capability), ['discovery', 'touchpoint-scan'])

    const capabilityWithoutWorkflow = await runCli(['--include', 'docker-smoke'])
    assert.equal(capabilityWithoutWorkflow.code, 1)
    assert.match(capabilityWithoutWorkflow.stderr, /select a workflow with --workflow/)

    const inputPath = join(tempRoot, 'selection.json')
    const input = selection({ workflow: 'test-only', include: ['functional-probe'] })
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8')
    const before = await readFile(inputPath, 'utf8')
    const result = await runCli(['--selection', inputPath, '--format', 'json'])
    const after = await readFile(inputPath, 'utf8')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(after, before, 'Planner must not modify the selection file')
    assert.equal(JSON.parse(result.stdout).selection.workflow, 'test-only')

    const invalid = await runCli(['--workflow', 'naming-registry', '--include', 'registry-query', '--exclude', 'naming-local'])
    assert.equal(invalid.code, 1)
    assert.match(invalid.stderr, /registry-query requires excluded capability naming-local/)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  await runWorkflowPlannerChecks()
  console.log('Workflow planner checks OK: pre-run menu, schema sync, explicit selections, dependency gates, confirmations, read-only CLI')
}
