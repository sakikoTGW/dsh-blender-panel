// Test suite for the Model Deck plugin (host routes + client/viewer contracts).
// Run: node --test tests/model-deck.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const HOST = process.env.DECK_HOST || 'http://127.0.0.1:53265'
const ROOT_ROUTE = HOST + '/blender-panel'

async function get(path) {
  const response = await fetch(ROOT_ROUTE + path)
  return { status: response.status, text: await response.text(), headers: response.headers }
}

function syntaxCheck(rel) {
  const result = spawnSync(process.execPath, ['--check', join(root, rel)], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${rel} should parse: ${result.stderr}`)
}

test('every entry file parses', () => {
  for (const file of ['index.js', 'client.js', 'lib/viewer.js', 'lib/launcher.js']) syntaxCheck(file)
})

test('client registers a tab and a blend/glb file viewer', () => {
  const source = read('client.js')
  assert.match(source, /registerTab\(/)
  assert.match(source, /registerFileViewer\(/)
  assert.match(source, /exts:\s*\[[^\]]*'blend'[^\]]*\]/)
  assert.match(source, /exts:\s*\[[^\]]*'glb'[^\]]*\]/)
})

test('client publishes the cross-plugin pick contract', () => {
  const source = read('client.js')
  assert.match(source, /dsh:model-pick/)
  assert.match(source, /window\.dshModelDeck\s*=/)
})

test('client supports multi-pick, notes and focus', () => {
  const source = read('client.js')
  assert.match(source, /remove-pick/)
  assert.match(source, /clear-picks/)
  assert.match(source, /focus-pick/)
  assert.match(source, /标注/)
  assert.match(source, /复制全部/)
})

test('viewer ships toolbar, picking and saved views', () => {
  const viewer = read('lib/viewer.js')
  for (const needle of [
    'saveview',
    "id=\"views\"",
    'blender-picks',
    'addMarker',
    'Raycaster',
    'focus-pick',
    'data-group="light"',
    'data-group="bg"',
    'data-group="mat"',
  ]) {
    assert.ok(viewer.includes(needle), `viewer should contain ${needle}`)
  }
})

test('index serves glb directly and has no floating-window path', () => {
  const source = read('index.js')
  assert.match(source, /model\/gltf-binary/)
  assert.ok(!/overlay/i.test(source), 'index should not mention an overlay mode')
})

test('launcher inspection reports a cmd-safe file without writing', () => {
  const source = read('lib/launcher.js')
  assert.match(source, /export function inspectLauncher/)
  assert.match(source, /export function syncLaunchFlags/)
  const vendor = 'E:\\DSH-App\\launch-official.cmd'
  if (!existsSync(vendor)) return
  const before = readFileSync(vendor)
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import('${join(root, 'lib/launcher.js').replace(/\\/g, '/')}').then(m => console.log(JSON.stringify(m.inspectLauncher())))`,
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const health = JSON.parse(result.stdout.trim())
  assert.equal(health.bareLf, 0, 'vendor launcher must not contain bare LF')
  assert.deepEqual(readFileSync(vendor), before, 'inspection must not modify the vendor launcher')
})

test('launcher flag sync is CRLF-safe on a scratch copy', () => {
  const scratch = mkdtempSync(join(root, '.tmp-launcher-'))
  const copy = join(scratch, 'launch-official.cmd')
  const vendor = 'E:\\DSH-App\\launch-official.cmd'
  if (!existsSync(vendor)) return
  copyFileSync(vendor, copy)
  try {
    const script = `
      import('${join(root, 'lib/launcher.js').replace(/\\/g, '/')}').then((m) => {
        const added = m.syncLaunchFlags(false, ${JSON.stringify(copy)})
        const removed = m.syncLaunchFlags(true, ${JSON.stringify(copy)})
        console.log(JSON.stringify({ added, removed }))
      })
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const { added, removed } = JSON.parse(result.stdout.trim())
    assert.equal(added.ok, true)
    assert.equal(added.bareLf, 0)
    assert.ok(added.flags.includes('--disable-direct-composition'))
    assert.equal(removed.ok, true)
    assert.equal(removed.hasFlags, false)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('live host: files endpoint lists models and points at the tripo glb', async () => {
  try {
    const result = await get('/files')
    assert.equal(result.status, 200)
    const payload = JSON.parse(result.text)
    assert.ok(Array.isArray(payload.files) && payload.files.length > 0)
    assert.match(payload.default, /model\.glb$/)
  } catch (error) {
    assert.fail('host unreachable: ' + error.message)
  }
})

test('live host: glb endpoint streams binary model data', async () => {
  const files = JSON.parse((await get('/files')).text)
  const target = files.default
  const response = await fetch(`${ROOT_ROUTE}/glb?file=${encodeURIComponent(target)}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'model/gltf-binary')
  const bytes = (await response.arrayBuffer()).byteLength
  assert.ok(bytes > 1_000_000, 'glb should be a real model file')
})

test('live host: viewer page exposes the control surface', async () => {
  const response = await get('/viewer?file=x')
  assert.equal(response.status, 200)
  for (const needle of ['saveview', 'blender-picks', 'focus-pick', 'data-group="mat"']) {
    assert.ok(response.text.includes(needle), 'viewer payload should include ' + needle)
  }
})

test('live host: launchflags status is read-only', async () => {
  const vendor = 'E:\\DSH-App\\launch-official.cmd'
  const before = existsSync(vendor) ? readFileSync(vendor) : null
  const response = await get('/host/launchflags')
  assert.equal(response.status, 200)
  const health = JSON.parse(response.text)
  assert.equal(health.ok, true)
  assert.equal(health.bareLf, 0)
  if (before !== null) assert.deepEqual(readFileSync(vendor), before, 'status must not rewrite the launcher')
})
