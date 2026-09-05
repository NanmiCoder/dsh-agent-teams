import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { inject, listHostProviders } from './host-domain.mjs'
import { listClientProviders } from './client-remote.mjs'

export async function runFaceContractChecks() {
  assert.deepEqual(inject, ['llm'], 'Host fixture must inject the domain service, not remote')

  let hostCalls = 0
  const hostResult = listHostProviders({
    llm: {
      listProviders() {
        hostCalls += 1
        return ['deepseek']
      },
    },
    get remote() {
      throw new Error('Host fixture must never read the client remote face')
    },
  })
  assert.deepEqual(hostResult, ['deepseek'])
  assert.equal(hostCalls, 1)

  const success = await listClientProviders({
    remote: { llm: { async listProviders() { return { ok: true, value: ['deepseek'] } } } },
  })
  assert.deepEqual(success, { status: 'ok', value: ['deepseek'] })

  let cancellationCalls = 0
  const cancelled = await listClientProviders({
    remote: {
      llm: {
        async listProviders() {
          cancellationCalls += 1
          return { ok: false, error: { code: 'gateway/cancelled', details: {} } }
        },
      },
    },
  })
  assert.deepEqual(cancelled, { status: 'cancelled' })
  assert.equal(cancellationCalls, 1, 'Cancellation must not retry')

  const remoteFailure = Object.assign(new Error('not found'), {
    code: 'session/not-found',
    details: { sessionId: 'missing' },
  })
  await assert.rejects(
    listClientProviders({
      remote: { llm: { async listProviders() { return { ok: false, error: remoteFailure } } } },
    }),
    (error) => error === remoteFailure,
    'Unknown/domain Remote failures must retain identity and details',
  )

  const assemblyFailure = new Error('remote contribution is not mounted')
  await assert.rejects(
    listClientProviders({
      remote: { llm: { async listProviders() { throw assemblyFailure } } },
    }),
    (error) => error === assemblyFailure,
    'Assembly/programming rejects must not be folded into RemoteResult',
  )
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  await runFaceContractChecks()
  console.log('Face contract examples OK: Host domain service + Client RemoteResult')
}
