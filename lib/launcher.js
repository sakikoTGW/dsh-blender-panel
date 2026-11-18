import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** Installed DSH launcher. The plugin never rewrites it on its own. */
export const LAUNCHER = 'E:\\DSH-App\\launch-official.cmd'

/**
 * The only switch needed: keep DWM redirection so native child windows can be
 * composed inside the app window. GPU rendering is unaffected.
 * `--require` is deliberately absent: it crashed startup on a previous attempt.
 */
export const LAUNCH_FLAGS = ['--disable-direct-composition']

const START_LINE = /^start\s+""\s+"([^"]+)"[^\r\n]*$/m

/** Read-only health of the launcher: cmd.exe cannot parse bare LF. */
export function inspectLauncher(path = LAUNCHER) {
  if (!existsSync(path)) return { ok: false, error: 'launcher-missing', path }
  const bytes = readFileSync(path)
  let crlf = 0
  let bareLf = 0
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue
    if (index > 0 && bytes[index - 1] === 0x0d) crlf += 1
    else bareLf += 1
  }
  const text = bytes.toString('utf8')
  return {
    ok: true,
    path,
    bytes: bytes.length,
    crlf,
    bareLf,
    hasFlags: LAUNCH_FLAGS.every((flag) => text.includes(flag)),
  }
}

/**
 * Add or remove the presentation flag on the `start` line only.
 *
 * Every write is validated afterwards: a file with a bare LF is rolled back,
 * because cmd.exe silently fails to run such a batch file.
 */
export function syncLaunchFlags(remove = false, path = LAUNCHER) {
  try {
    if (!existsSync(path)) return { ok: false, error: 'launcher-missing', path }
    const before = readFileSync(path)
    const text = before.toString('utf8')
    const match = text.match(START_LINE)
    if (match === null) return { ok: false, error: 'start-line-not-found', path }

    const exe = match[1]
    if (!existsSync(exe)) return { ok: false, error: 'exe-missing', path, exe }

    const flags = remove ? [] : LAUNCH_FLAGS
    const desired = `start "" "${exe}"${flags.length === 0 ? '' : ` ${flags.join(' ')}`}`
    if (match[0] === desired) {
      return { ok: true, action: 'already', ...inspectLauncher(path) }
    }

    const backup = `${path}.dsh-backup`
    if (!existsSync(backup)) writeFileSync(backup, before)

    writeFileSync(path, text.replace(START_LINE, () => desired), 'utf8')
    const health = inspectLauncher(path)
    if (!health.ok || health.bareLf > 0) {
      writeFileSync(path, before)
      return { ok: false, error: 'validation-failed-rolled-back', ...health }
    }
    return { ok: true, action: remove ? 'removed' : 'updated', flags, ...health }
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 200), path }
  }
}
