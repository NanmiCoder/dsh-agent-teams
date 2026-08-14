#!/usr/bin/env node
/**
 * migrate-session-logs.mjs
 *
 * Repair DeepSeek Harness session logs written by dsh-agent-teams builds that
 * omitted the `ignorable` envelope marker (0.1.0 and earlier, and any local
 * build before the fix). The harness's persistence coordinator refuses to
 * interpret a log containing an event type outside its generated vocabulary
 * unless the event carries `"ignorable": true`; such logs fail with:
 *
 *   SessionFormatUnsupportedError: ... contains event type "agent-teams/..." ...
 *   unknown to this harness and not marked ignorable; refusing to interpret
 *   the log
 *
 * This tool rewrites each log in place: it decodes every Zstandard frame,
 * inserts `"ignorable": true` into each `agent-teams/*` event that lacks it
 * (all other bytes are preserved), and re-encodes the log as a header frame
 * plus one body frame using Node's own zstd implementation (checksummed,
 * matching the harness writer). It is idempotent: a second run changes
 * nothing.
 *
 * Usage:
 *   node scripts/migrate-session-logs.mjs <session.jsonl.zstd> [more logs...]
 *
 * Logs live under `$DSH_HOME/sessions/<project-dir>/<session-id>/`:
 *   find "$HOME/.dsh/sessions" -name session.jsonl.zstd \
 *     -exec node scripts/migrate-session-logs.mjs {} +
 *
 * Zero dependencies — Node.js >= 22.19 with built-in zstd support.
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { constants, zstdCompress, zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const compressFrame = promisify(zstdCompress)
const decompressFrame = promisify(zstdDecompress)

const ZSTD_MAGIC = 0xFD2FB528

/**
 * Locate complete Zstandard frames in a concatenated stream (the layout the
 * harness's JSONL backend writes: one independently decodable frame per
 * append batch). A structurally incomplete final frame is an error here:
 * migrate only logs whose committed prefix is whole.
 * @param buffer - the complete log bytes.
 * @returns byte ranges of every frame.
 */
export function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) throw new Error(`torn frame at byte ${offset}`)
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) throw new Error('torn frame (header missing)')
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error('reserved frame-header bit')
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) throw new Error('torn frame header')
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) throw new Error('torn block header')
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error('reserved block type')
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) throw new Error('torn block payload')
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) throw new Error('torn checksum')
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * Decode a complete concatenated stream to its plaintext.
 * @param buffer - the log bytes.
 * @param frames - frame ranges from {@link scanFrames}.
 * @returns the decoded UTF-8 text.
 */
export async function decodeLog(buffer, frames) {
  const parts = []
  for (const frame of frames) {
    const plain = await decompressFrame(buffer.subarray(frame.start, frame.end))
    parts.push(plain)
  }
  return Buffer.concat(parts).toString('utf8')
}

/**
 * Insert `"ignorable": true` into every `agent-teams/*` event line lacking
 * the marker, preserving every other byte.
 * @param text - the decoded log text.
 * @returns the patched text and how many events changed.
 */
export function patchAgentTeamsEvents(text) {
  const lines = text.split('\n')
  let patched = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('{"type":"agent-teams/')) continue
    if (line.includes('"ignorable"')) continue
    const match = /^\{"type":"(agent-teams\/[^"]+)"(.*)$/.exec(line)
    if (!match) continue
    lines[i] = `{"type":"${match[1]}","ignorable":true${match[2]}`
    patched += 1
  }
  return { text: lines.join('\n'), patched }
}

/**
 * Re-encode a log as a header frame plus one body frame (the same container
 * shape the harness reads; the JSONL backend accepts any frame layout).
 * @param text - the full log text (header line first).
 * @returns the encoded log bytes.
 */
export async function encodeLog(text) {
  const newline = text.indexOf('\n')
  if (newline === -1) throw new Error('log has no header line')
  const header = text.slice(0, newline + 1)
  const body = text.slice(newline + 1)
  const options = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
  const headerFrame = await compressFrame(header, options)
  const bodyFrame = await compressFrame(body, options)
  return Buffer.concat([headerFrame, bodyFrame])
}

/**
 * Migrate one log file in place. Idempotent: a log with no unmarked
 * `agent-teams/*` events is left untouched.
 * @param path - absolute path to a `session.jsonl.zstd` log.
 * @returns how many events were patched.
 */
export async function migrateLog(path) {
  const buffer = await readFile(path)
  const frames = scanFrames(buffer)
  if (frames.length === 0) throw new Error(`${path}: no frames`)
  const text = await decodeLog(buffer, frames)
  const { text: patchedText, patched } = patchAgentTeamsEvents(text)
  if (patched === 0) return 0
  const encoded = await encodeLog(patchedText)
  const tmp = `${path}.migrate-tmp`
  await writeFile(tmp, encoded)
  await rename(tmp, path)
  return patched
}

/**
 * In-memory self test: build a synthetic log containing unmarked
 * `agent-teams/*` events, migrate it, and assert the markers landed while
 * every other line stayed byte-identical.
 */
async function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`self-test failed: ${message}`)
  }
  const header = '{"type":"session","version":0,"id":"session-test","createdAt":1,"cwd":"/tmp"}\n'
  const event = '{"type":"agent-teams/task-created","seq":5,"time":2,"data":{"teamId":"t"}}'
  const plain = { type: 'user/message', seq: 6, time: 3, data: { content: [] } }
  const untouched = JSON.stringify(plain)
  const body = `${event}\n${untouched}\n`
  const encoded = await encodeLog(header + body)
  const migrated = await migrateString(encoded)
  assert(migrated.includes('"ignorable":true'), 'marker not inserted')
  assert(migrated.includes(untouched), 'non-agent-teams line changed')
  assert(migrated.includes(header), 'header changed')
  const { patched } = patchAgentTeamsEvents(migrated)
  assert(patched === 0, 'second pass should be a no-op')
  console.log('self-test OK')
}

/** Migrate an in-memory log buffer, returning the patched plaintext. */
async function migrateString(buffer) {
  const frames = scanFrames(buffer)
  const text = await decodeLog(buffer, frames)
  const { text: patchedText } = patchAgentTeamsEvents(text)
  return patchedText
}

const files = process.argv.slice(2)
if (files.length === 1 && files[0] === '--self-test') {
  await selfTest()
  process.exit(0)
}
if (files.length === 0) {
  console.error('usage: node scripts/migrate-session-logs.mjs <session.jsonl.zstd> [...]')
  console.error('       node scripts/migrate-session-logs.mjs --self-test')
  process.exit(2)
}
let total = 0
for (const file of files) {
  try {
    const patched = await migrateLog(file)
    total += patched
    console.log(`${patched > 0 ? 'patched' : 'clean  '} ${patched} event(s): ${file}`)
  } catch (error) {
    console.error(`FAILED ${file}: ${error.message}`)
    process.exitCode = 1
  }
}
console.log(`done: ${total} event(s) patched across ${files.length} log(s)`)
