/**
 * dsh-blender-panel 闁?闁?Better Sidebar 闂佹彃鏈€垫洘绋夐埀顒佺▔椤忓棙鍩傞柣?Blender 閻熸瑥妫楀ù姗€濡? *
 * 濞戞挸绉靛Σ鎼佸箣椤忓嫭绂堥柨娑欘儢ost 闁?.blend 閻庣數鍘ч崵顓㈠箣?GLB闁挎稑鐗呯换姘舵偩濞嗘垶鍩傞悗鍦仜閸ゆ垶鎷呴弴姘辩憿闁哄鍔樺婵嬫晬婢舵稓绀塁lient 濡炪倗鏁搁鐑芥煂? * 闁?three.js 闁绘粍婢樺┃鈧柛鏃傚Ь濞村洭鏁嶇仦钘夎濞寸姰鍎茬€氬宕濋妸锔筋棆閺夌儐鍏欓埀顑跨劍缁瓨娼鍓х礆闁衡偓娣囨墎鍋撴担绋跨闂佹鍠栭柦鈺冪矓濮瑰洠鍋撻崒娑欑€ù鐘虫构缁斿瓨绌卞┑鍡欐憼閻忓繘浜堕崳鎼佸棘? * 閻庣數鍘ч崵顓㈢嵁鐠哄搫鐓曢柡鍌涘椤宕堕幘鍛耿闁告瑱绠戦ˇ缁樻交濡粯绠掑☉鎾亾濞戞搩浜楅埀顒€鑻﹢?Blender 濞戞搩鍘芥晶锕€顕ｉ埀顒勫Υ瀹ュ棗鐦婚梺绛嬪櫙缁辨繈鎯勭€涙ê澶嶉柟宄邦槼閹癸綁寮甸浣圭皻 Blender闁? *
 * 闁圭鍋撻柡鍫濐槼閻箖鎮介崡鐐叉锭闁规亽鍎辫ぐ鍫ュ嫉椤掍焦绨氶柛銉у仧楠炲棝宕烽弶鎸庣祷闁挎稑濂旂粭鏍矗椤忓嫬甯掗悹浣圭摃椤旀牠姊婚鈧崢銈囩磾椤旂晫澹岄柣鈺婂枛缂嶅秹宕橀崨顖涚暠 .blend闁? *
 * @module @local/dsh-blender-panel
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, createReadStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectLauncher, syncLaunchFlags } from './lib/launcher.js'
import { renderViewerHtml } from './lib/viewer.js'
import { createRequire } from 'node:module'

export const name = 'dsh-blender-panel'
export const inject = ['webServer', 'tools']

const ROUTE = '/blender-panel'
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = join(PACKAGE_DIR, 'assets')
const MAX_BODY = 16 * 1024
const EXPORT_TIMEOUT_MS = 3 * 60 * 1000
const BRIDGE_PORT = Number.parseInt(process.env.DSH_BLENDER_BRIDGE_PORT ?? '8731', 10)
const BRIDGE_ORIGIN = `http://127.0.0.1:${BRIDGE_PORT}`

const EMBED_SCRIPT = join(PACKAGE_DIR, 'native', 'embed.ps1')

/** Process id of the running Blender window, or 0. */
function blenderProcessId() {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', "(Get-Process blender -ErrorAction SilentlyContinue | Select-Object -First 1).Id"],
    { encoding: 'utf8', windowsHide: true, timeout: 8000 },
  )
  const value = Number.parseInt((result.stdout ?? '').trim(), 10)
  return Number.isFinite(value) ? value : 0
}

/** Run the Win32 window host helper and parse its JSON answer. */
function runEmbed(args) {
  const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', EMBED_SCRIPT, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  })
  const text = (result.stdout ?? '').trim().split('\n').filter((line) => line.trim() !== '').pop() ?? ''
  try {
    return JSON.parse(text)
  } catch {
    return { ok: false, error: text === '' ? String(result.stderr ?? '').slice(0, 300) : text.slice(0, 300) }
  }
}

/** Call the in-Blender bridge; null when it is not running. */async function bridgeCall(path, method, body) {
  try {
    const response = await fetch(`${BRIDGE_ORIGIN}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(method === 'GET' && path.startsWith('/shot') ? 60000 : 8000),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}
const DEFAULT_ROOT = 'E:\\逆向'
const DEFAULT_BLEND = 'E:\\逆向\\_hero\\anon\\tripo-tpose-model2\\tripo-out\\anon-tpose-v2-2-0b09cfbd\\model.glb'

function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(value))
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('payload too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

function toPosix(path) {
  return path.split(sep).join('/')
}

/** List .blend files under the configured root, shallow and bounded. */
export function listBlends(root, depth = 0, out = []) {
  if (depth > 4 || out.length >= 400) return out
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (out.length >= 400) break
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      listBlends(full, depth + 1, out)
    } else if (entry.isFile() && /\.(blend|glb|gltf)$/i.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Guard a client-supplied path to the configured root. */
export function insideRoot(root, candidate) {  if (typeof candidate !== 'string' || candidate === '') return false
  const base = resolve(root)
  const target = resolve(candidate)
  return target === base || target.startsWith(base + sep)
}

// Bump whenever the export pipeline changes: it is part of the cache key, so
// every cached GLB is rebuilt with the new algorithm instead of serving stale
// geometry (e.g. the pre-fix normals).
const EXPORTER_VERSION = 'v7'

function keyOf(path) {
  return createHash('sha1').update(`${path}|${EXPORTER_VERSION}`).digest('hex').slice(0, 12)
}

/**
 * Register the geometry routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ root?: string, blend?: string, blender?: string }} [config]
 */
/**
 * App-layer patch (mods-style): the shell's GPU compositor hides native child
 * windows, so ask Chromium for software compositing on the next launch.
 */
function patchElectronHost() {
  try {
    const require2 = createRequire(import.meta.url)
    const electron = require2('electron')
    const app = electron !== null && typeof electron === 'object' ? electron.app : undefined
    if (app === undefined || app === null) return 'no-electron'
    if (typeof app.commandLine?.appendSwitch === 'function') {
      app.commandLine.appendSwitch('disable-gpu-compositing')
      app.commandLine.appendSwitch('disable-direct-composition')
      return 'switch-queued'
    }
    return 'no-commandline'
  } catch (error) {
    return `error:${String(error).slice(0, 120)}`
  }
}


/** Launcher path of the installed DSH app (managed as a mod by this plugin). */

const SHORTCUTS_SCRIPT = join(PACKAGE_DIR, 'native', 'shortcuts.ps1')

/** Point the user's own icons at the watchdog launcher (or restore them). */
function syncShortcuts(action = 'install') {
  if (!existsSync(SHORTCUTS_SCRIPT)) return { ok: false, error: 'script-missing' }
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SHORTCUTS_SCRIPT, '-Action', action],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 },
  )
  const text = (result.stdout ?? '').trim()
  try {
    return { ok: true, action, entries: JSON.parse(text === '' ? '[]' : text) }
  } catch {
    return { ok: false, error: text.slice(0, 200) }
  }
}

export function apply(ctx, config = {}) {
  const root = typeof config.root === 'string' && config.root !== '' ? config.root : DEFAULT_ROOT
  const blender =
    typeof config.blender === 'string' && config.blender !== ''
      ? config.blender
      : process.env.BLENDER_EXE || 'E:\\Blender\\blender.exe'
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const cacheDir = join(home, 'blender-panel')
  try {
    mkdirSync(cacheDir, { recursive: true })
  } catch {
    /* surfaced per export */
  }

  /** Messages Blender pushes into DSH (cross-window inbox). */
  const intake = []
  let nextIntakeId = 1

  /** path 闁?{ promise, exporting, error, exportedAt } */  const jobs = new Map()

  const glbPath = (path) => join(cacheDir, `${keyOf(path)}.glb`)

  const statMtime = (path) => {
    try {
      return statSync(path).mtimeMs
    } catch {
      return 0
    }
  }

  const statSize = (path) => {
    try {
      return statSync(path).size
    } catch {
      return 0
    }
  }

  const jobOf = (path) => {
    let job = jobs.get(path)
    if (job === undefined) {
      job = { promise: null, exporting: false, error: null, exportedAt: 0 }
      jobs.set(path, job)
    }
    return job
  }

  const startExport = (path) => {
    const job = jobOf(path)
    if (job.promise !== null) return job
    job.exporting = true
    job.error = null
    const out = glbPath(path)
    const expr = [
      'import bpy',
      'stage = ("floor", "backdrop", "stage_floor", "ground", "Icosphere", "Plane", "wall")',
      'meshes = [o for o in bpy.data.objects if o.type == "MESH"]',
      'chars = [o for o in meshes if not any(o.name.startswith(p) for p in stage) and (o.name.startswith("tripo_node") or o.name.startswith("character") or len(o.data.polygons) > 2000)]',
      'arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]',
      'bpy.ops.object.select_all(action="DESELECT")',
      'sel = (chars if chars else meshes) + arms',
      '[o.select_set(True) for o in sel]',
      'bpy.context.view_layer.objects.active = arms[0] if arms else (sel[0] if sel else None)',
      // No modifier bake and no normal rewriting: the viewer applies the pose on
      // the GPU, so the export stays exactly as the rig produced it.
      `bpy.ops.export_scene.gltf(filepath=${JSON.stringify(out)}, export_format='GLB', export_apply=False, export_skins=True, export_animations=False, export_tangents=False, use_selection=True)`,
    ].join('\n')
    const args = ['-b', path, '--python-expr', expr]
    job.promise = new Promise((resolvePromise) => {
      let stderr = ''
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        job.exporting = false
        job.promise = null
        if (error !== null) {
          job.error = error
        } else if (existsSync(out)) {
          job.exportedAt = Date.now()
        } else {
          job.error = 'export produced no file'
        }
        resolvePromise(job)
      }
      const child = spawn(blender, args, { windowsHide: true })
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        finish('export timed out')
      }, EXPORT_TIMEOUT_MS)
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8')
        if (stderr.length > 8000) stderr = stderr.slice(-8000)
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        finish(String(error?.message ?? error))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          finish(null)
        } else {
          const tail = stderr.trim().split('\n').slice(-4).join(' | ')
          finish(`blender exited ${code}${tail === '' ? '' : `: ${tail}`}`)
        }
      })
    })
    return job
  }

  const stateOf = (path) => {
    const job = jobOf(path)
    return {
      file: path,
      mtime: statMtime(path),
      glbMtime: statMtime(glbPath(path)),
      exporting: job.exporting,
      exportedAt: job.exportedAt,
      error: job.error,
    }
  }

  

  const handler = async (req, res) => {
    try {
      if (!isLoopback(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')

      if (url.pathname === `${ROUTE}/files` && req.method === 'GET') {
        const files = listBlends(root).map((path) => ({
          path,
          label: toPosix(path).slice(toPosix(root).length + 1),
          mtime: statMtime(path),
        }))
        files.sort((left, right) => right.mtime - left.mtime)
        // the declared default must always be selectable, even past the listing cap
        if (existsSync(DEFAULT_BLEND) && !files.some((entry) => entry.path === DEFAULT_BLEND)) {
          files.unshift({
            path: DEFAULT_BLEND,
            label: toPosix(DEFAULT_BLEND).slice(toPosix(root).length + 1),
            mtime: statMtime(DEFAULT_BLEND),
          })
        }
        sendJson(res, 200, { root, files, default: DEFAULT_BLEND })
        return
      }

      if (url.pathname === `${ROUTE}/state` && req.method === 'GET') {
        const file = url.searchParams.get('file') ?? ''
        if (!insideRoot(root, file)) {
          sendJson(res, 400, { error: 'outside-root' })
          return
        }
        sendJson(res, 200, stateOf(file))
        return
      }

      if (url.pathname === `${ROUTE}/glb` && req.method === 'GET') {
        const file = url.searchParams.get('file') ?? ''
        if (!insideRoot(root, file) || !existsSync(file)) {
          sendJson(res, 400, { error: 'invalid-file' })
          return
        }
        // A .glb/.gltf is served as-is: no Blender round-trip, no rewriting.
        if (/\.(glb|gltf)$/i.test(file)) {
          const raw = readFileSync(file)
          res.statusCode = 200
          res.setHeader('Content-Type', /gltf$/i.test(file) ? 'model/gltf+json' : 'model/gltf-binary')
          res.setHeader('Content-Length', String(raw.length))
          res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
          res.end(raw)
          return
        }
        const stale = statMtime(file) > statMtime(glbPath(file))
        const job = stale || !existsSync(glbPath(file)) ? startExport(file) : jobOf(file)
        if (job.promise !== null) await job.promise
        if (!existsSync(glbPath(file))) {
          sendJson(res, 500, { error: job.error ?? 'export-failed' })
          return
        }
        const glb = glbPath(file)
        const size = statSize(glb)
        res.statusCode = 200
        res.setHeader('Content-Type', 'model/gltf-binary')
        res.setHeader('Content-Length', String(size))
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
        // Stream instead of buffering: the host route is slow with one huge write.
        await new Promise((resolvePromise) => {
          const stream = createReadStream(glb)
          stream.on('error', () => {
            try {
              res.destroy()
            } catch {
              /* ignore */
            }
            resolvePromise()
          })
          stream.on('end', resolvePromise)
          stream.pipe(res)
        })
        return
      }

      if (url.pathname === `${ROUTE}/open` && req.method === 'POST') {
        const body = await readJson(req)
        const file = typeof body.file === 'string' ? body.file : ''
        if (!insideRoot(root, file) || !existsSync(file)) {
          sendJson(res, 400, { error: 'invalid-file' })
          return
        }
        const bridgeResult = await bridgeCall('/file', 'POST', { action: 'open', path: file })
        if (bridgeResult !== null && bridgeResult.ok) {
          sendJson(res, 200, { ok: true, file, via: 'bridge' })
          return
        }
        const child = spawn(blender, [file], { detached: true, stdio: 'ignore' })
        child.unref()
        sendJson(res, 200, { ok: true, file, via: 'spawn' })
        return
      }

      if (url.pathname === `${ROUTE}/bridge/launch` && req.method === 'POST') {
        const existing = await bridgeCall('/state', 'GET')
        if (existing !== null && existing.ok) {
          sendJson(res, 200, { ok: true, already: true })
          return
        }
        // Only ever start Blender when the panel can actually host it: a window
        // that cannot be embedded would float over the UI, so refuse instead.
        const style = runEmbed(['-Action', 'ownerstyle'])
        if (style.ok !== true || style.noredirection === true) {
          sendJson(res, 200, { ok: false, error: 'host-not-ready', needsLauncher: true })
          return
        }
        const script = join(PACKAGE_DIR, 'addon', 'dsh_bridge.py')
        if (!existsSync(script)) {
          sendJson(res, 500, { error: 'bridge-script-missing' })
          return
        }
        const body = await readJson(req)
        const x = Math.round(Number(body.x) || 0)
        const y = Math.round(Number(body.y) || 0)
        const w = Math.round(Number(body.w) || 900)
        const h = Math.round(Number(body.h) || 900)
        const child = spawn(
          blender,
          ['--window-geometry', String(x), String(y), String(w), String(h), '--python', script],
          { detached: true, stdio: 'ignore', env: { ...process.env, DSH_WEB_URL: ctx.webServer.getOrigin() } },
        )
        child.unref()

        const args = ['-Action', 'child',
          '-X', String(x), '-Y', String(y), '-W', String(w), '-H', String(h)]
        let embedded = false
        let lastError = ''
        for (let attempt = 0; attempt < 260; attempt += 1) {
          // Poll fast: the child style (tool window, no taskbar entry) is applied
          // on the first successful attach, so the icon never lingers.
          await new Promise((resolve) => setTimeout(resolve, 120))
          const result = runEmbed(args)
          if (result.ok === true) {
            embedded = true
            break
          }
          lastError = String(result.error ?? '')
        }
        if (!embedded) runEmbed(['-Action', 'detach'])
        sendJson(res, 200, {
          ok: true,
          embedded,
          mode: embedded ? 'child' : undefined,
          error: embedded ? undefined : lastError === '' ? 'embed-failed' : lastError,
        })
        return
      }

      if (url.pathname === `${ROUTE}/wb/state` && req.method === 'GET') {
        const state = await bridgeCall('/state', 'GET')
        sendJson(res, 200, state ?? { ok: false, error: 'bridge-offline' })
        return
      }

      if (url.pathname.startsWith(`${ROUTE}/wb/`) && req.method === 'POST') {
        const action = url.pathname.slice(`${ROUTE}/wb/`.length)
        const body = await readJson(req)
        const result = await bridgeCall(`/${action}`, 'POST', body)
        sendJson(res, 200, result ?? { ok: false, error: 'bridge-offline' })
        return
      }

      if (url.pathname === `${ROUTE}/embed` && req.method === 'POST') {
        const body = await readJson(req)
        const pid = blenderProcessId()
        if (pid === 0) {
          sendJson(res, 200, { ok: false, error: 'blender-not-running' })
          return
        }
        const style = runEmbed(['-Action', 'ownerstyle'])
        if (style.ok !== true || style.noredirection === true) {
          sendJson(res, 200, { ok: false, error: 'host-not-ready', needsLauncher: true })
          return
        }
        const action = 'child'
        const args = ['-Action', action,
          '-X', String(Math.round(Number(body.x) || 0)), '-Y', String(Math.round(Number(body.y) || 0)),
          '-W', String(Math.round(Number(body.w) || 800)), '-H', String(Math.round(Number(body.h) || 900))]
        // Blender can take a few seconds to show its window; retry briefly.
        let result = runEmbed(args)
        for (let attempt = 0; attempt < 10 && result.ok !== true; attempt += 1) {
          if (result.error !== 'blender-window-not-found') break
          await new Promise((resolve) => setTimeout(resolve, 1000))
          result = runEmbed(args)
        }
        sendJson(res, 200, result)
        return
      }

      if (url.pathname === `${ROUTE}/host/shortcuts` && req.method === 'POST') {
        const body = await readJson(req)
        sendJson(res, 200, syncShortcuts(body.restore === true ? 'restore' : 'install'))
        return
      }

      if (url.pathname === `${ROUTE}/host/shortcuts` && req.method === 'GET') {
        sendJson(res, 200, syncShortcuts('status'))
        return
      }

      if (url.pathname === `${ROUTE}/host/launchflags` && req.method === 'GET') {
        // Read-only: never rewrite the vendor launcher from a status check.
        sendJson(res, 200, inspectLauncher())
        return
      }

      if (url.pathname === `${ROUTE}/host/launchflags` && req.method === 'POST') {
        const body = await readJson(req)
        sendJson(res, 200, syncLaunchFlags(body.remove === true))
        return
      }

      if (url.pathname === `${ROUTE}/host/probe` && req.method === 'GET') {
        const info = {
          electron: process.versions.electron ?? null,
          chrome: process.versions.chrome ?? null,
          hasMainModule: Boolean(process.mainModule),
          type: process.type ?? null,
        }
        try {
          const bare = await import('electron')
          info.bareImport = Object.keys(bare).slice(0, 10)
        } catch (error) {
          info.bareImportError = String(error).slice(0, 140)
        }
        try {
          const appRequire = createRequire('E:\\DSH-App\\resources\\app.asar\\package.json')
          const electron = appRequire('electron')
          info.appRequire = typeof electron
          info.appWindows = electron?.BrowserWindow?.getAllWindows?.().length ?? -1
        } catch (error) {
          info.appRequireError = String(error).slice(0, 140)
        }
        try {
          const electronModule = await import('node:electron')
          info.viaNodeElectron = typeof electronModule
          info.keys = Object.keys(electronModule).slice(0, 12)
          const app = electronModule.app ?? electronModule.default?.app
          if (app !== undefined) {
            const windows = (electronModule.BrowserWindow ?? electronModule.default?.BrowserWindow)?.getAllWindows?.() ?? []
            info.windows = windows.length
          }
        } catch (error) {
          info.nodeElectronError = String(error).slice(0, 160)
        }
        sendJson(res, 200, info)
        return
      }

      if (url.pathname === `${ROUTE}/host/patch` && req.method === 'POST') {
        try {
          const electronModule = await import('electron')
          const electron = electronModule['module.exports'] ?? electronModule.default ?? electronModule
          const windows = electron.BrowserWindow.getAllWindows()
          const target = windows.find((win) => !win.isDestroyed() && win.isVisible())
          if (target === undefined) {
            sendJson(res, 200, { ok: false, error: 'no-window' })
            return
          }
          const applied = {}
          try {
            target.setBackgroundMaterial('none')
            applied.backgroundMaterial = 'none'
          } catch (error) {
            applied.backgroundMaterial = String(error).slice(0, 120)
          }
          try {
            target.setHasShadow(false)
            applied.shadow = false
          } catch (error) {
            applied.shadow = String(error).slice(0, 80)
          }
          sendJson(res, 200, { ok: true, windows: windows.length, applied })
        } catch (error) {
          sendJson(res, 200, { ok: false, error: String(error).slice(0, 200) })
        }
        return
      }

      if (url.pathname === `${ROUTE}/hide` && req.method === 'POST') {
        sendJson(res, 200, runEmbed(['-Action', 'hide']))
        return
      }

      if (url.pathname === `${ROUTE}/show` && req.method === 'POST') {
        sendJson(res, 200, runEmbed(['-Action', 'show']))
        return
      }

      if (url.pathname === `${ROUTE}/detach` && req.method === 'POST') {
        sendJson(res, 200, runEmbed(['-Action', 'detach']))
        return
      }

      if (url.pathname === `${ROUTE}/viewer` && req.method === 'GET') {
        // "open with": /viewer without a file opens the default scene
        if (!url.searchParams.get('file')) {
          res.statusCode = 302
          res.setHeader('Location', `${ROUTE}/viewer?file=${encodeURIComponent(DEFAULT_BLEND)}`)
          res.end()
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(renderViewerHtml())
        return
      }

      if (url.pathname === `${ROUTE}/intake` && req.method === 'POST') {
        const body = await readJson(req)
        const text = typeof body.text === 'string' ? body.text : ''
        if (text.trim() === '') {
          sendJson(res, 400, { error: 'empty-text' })
          return
        }
        intake.push({ id: nextIntakeId++, text, source: String(body.source ?? 'blender'), at: Date.now() })
        if (intake.length > 200) intake.splice(0, intake.length - 200)
        sendJson(res, 200, { ok: true })
        return
      }

      if (url.pathname === `${ROUTE}/intake` && req.method === 'GET') {
        const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10) || 0
        sendJson(res, 200, { messages: intake.filter((entry) => entry.id > since) })
        return
      }

      if (url.pathname.startsWith(`${ROUTE}/assets/`) && req.method === 'GET') {
        const name = url.pathname.slice(`${ROUTE}/assets/`.length)
        const full = resolve(ASSETS_DIR, name)
        if (!full.startsWith(ASSETS_DIR + sep)) {
          sendJson(res, 400, { error: 'bad-asset' })
          return
        }
        if (!existsSync(full)) {
          sendJson(res, 404, { error: 'not-found' })
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'public, max-age=86400')
        res.end(readFileSync(full))
        return
      }

      sendJson(res, 404, { error: 'not-found' })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler }))

  // Point the user's own icons at the watchdog launcher: no special command to
  // remember, and the vendor launcher stays untouched.
  try {
    syncShortcuts('install')
  } catch {
    /* best effort */
  }

  const hostPatch = patchElectronHost()
  // The vendor launcher is NOT touched automatically: startup must stay
  // reproducible. Use launch-dsh.cmd (watchdog + fallback) to get the flags.
  ctx.logger?.info?.(`[blender-panel] host patch: ${hostPatch}; launcher left untouched`);

  // Cross-window tools: the agent drives the live Blender session, and reads
  // what Blender pushes back through /intake.
  const renderJson = (value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  const bridgeTool = (name, description, parameters, run) => {
    const properties = {}
    const required = []
    for (const [key, value] of Object.entries(parameters ?? {})) {
      const { required: isRequired, ...schema } = value
      properties[key] = schema
      if (isRequired === true) required.push(key)
    }
    return {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        additionalProperties: false,
        ...(required.length === 0 ? {} : { required }),
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderJson(value) },
      isConcurrencySafe: () => true,
      async execute(args) {
        const result = await run(args ?? {})
        return result ?? { ok: false, error: 'bridge-offline' }
      },
    }
  }

  ctx.effect(() =>
    ctx.tools.register(
      bridgeTool(
        'blender_live_state',
        'Read the scene that is open in the live Blender session: collections, objects, visibility, selection, active object, engine, frame, materials.',
        {},
        () => bridgeCall('/state', 'GET'),
      ),
    ),
  )

  ctx.effect(() =>
    ctx.tools.register(
      bridgeTool(
        'blender_live_python',
        'Run Python inside the live Blender session and return the value assigned to `result`. This mutates the open scene.',
        {
          code: { type: 'string', required: true, description: 'Python source executed in Blender; assign to `result` to return a value.' },
        },
        (args) => {
          if (typeof args.code !== 'string' || args.code.trim() === '') throw new Error('code is required')
          return bridgeCall('/python', 'POST', { code: args.code })
        },
      ),
    ),
  )

  ctx.effect(() =>
    ctx.tools.register(
      bridgeTool(
        'blender_live_open',
        'Open a .blend file in the live Blender session.',
        {
          path: { type: 'string', required: true, description: 'Absolute path of an existing .blend file.' },
        },
        (args) => {
          if (typeof args.path !== 'string' || !existsSync(args.path)) throw new Error('path must be an existing .blend file')
          return bridgeCall('/file', 'POST', { action: 'open', path: args.path })
        },
      ),
    ),
  )

  ctx.effect(() =>
    ctx.tools.register(
      bridgeTool(
        'blender_live_select',
        'Select an object in the live Blender session, optionally extending the selection.',
        {
          name: { type: 'string', required: true, description: 'Object name.' },
          extend: { type: 'boolean', description: 'Add to the current selection instead of replacing it.' },
        },
        (args) => bridgeCall('/select', 'POST', { name: String(args.name ?? ''), extend: Boolean(args.extend) }),
      ),
    ),
  )

  ctx.effect(() =>
    ctx.tools.register(
      bridgeTool(
        'blender_live_settings',
        'Change render settings of the live Blender session: engine, frame, resolution, Cycles samples.',
        {
          engine: { type: 'string', description: 'Render engine, e.g. CYCLES or BLENDER_EEVEE_NEXT.' },
          frame: { type: 'integer', description: 'Current frame.' },
          resolution: { type: 'array', items: { type: 'integer' }, description: '[width, height].' },
          samples: { type: 'integer', description: 'Cycles sample count.' },
        },
        (args) => {
          const values = {}
          if (typeof args.engine === 'string') values.engine = args.engine
          if (Number.isInteger(args.frame)) values.frame = args.frame
          if (Array.isArray(args.resolution) && args.resolution.length === 2) values.resolution = args.resolution
          if (Number.isInteger(args.samples)) values.samples = args.samples
          if (Object.keys(values).length === 0) throw new Error('nothing to change')
          return bridgeCall('/settings', 'POST', { values })
        },
      ),
    ),
  )

  ctx.effect(() =>
    ctx.tools.register(
      bridgeTool(
        'blender_inbox',
        'Read messages Blender sent to DSH from inside the Blender window (the cross-window inbox).',
        {
          since: { type: 'integer', description: 'Only messages with a larger id; defaults to 0 (all).' },
        },
        (args) => ({ ok: true, messages: intake.filter((entry) => entry.id > (Number(args.since) || 0)) }),
      ),
    ),
  )
}
