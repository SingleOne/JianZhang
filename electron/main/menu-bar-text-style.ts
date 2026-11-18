import { createRequire } from 'node:module'
import { join } from 'node:path'

let installed = false

export function installMenuBarTextStyle(): void {
  if (installed || process.platform !== 'darwin') return
  // The Node-API module is emitted beside the main bundle and unpacked from
  // ASAR. Loading it installs styling only on this process's status buttons.
  installed = true
  try {
    createRequire(__filename)(join(__dirname, 'menu-bar-text.node'))
  } catch (error) {
    // Styling is optional; an unavailable addon must not prevent quotes or the
    // rest of the application from opening.
    console.error('菜单栏文字描边加载失败', error)
  }
}
