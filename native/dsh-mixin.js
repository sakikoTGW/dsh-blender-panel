/*
 * DSH mixin (Minecraft-style coremod): injected with `--require` before the
 * Electron app initializes, so presentation switches actually apply to the
 * first window. Managed by @local/dsh-blender-panel; remove the launcher flag
 * to disable it.
 */
const { app } = require('electron')

const SWITCHES = ['disable-direct-composition']

try {
  for (const flag of SWITCHES) {
    if (typeof app?.commandLine?.appendSwitch === 'function') {
      app.commandLine.appendSwitch(flag)
    }
  }
  console.log('[dsh-mixin] presentation switches queued:', SWITCHES.join(', '))
} catch (error) {
  console.error('[dsh-mixin] failed:', error)
}
