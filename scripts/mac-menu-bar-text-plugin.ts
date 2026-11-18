import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Plugin } from 'vite'

export function macMenuBarTextPlugin(source: string): Plugin {
  return {
    name: 'mac-menu-bar-text',
    apply: 'build',
    buildStart() {
      if (process.platform !== 'darwin') return
      this.addWatchFile(source)
      this.addWatchFile(join(dirname(source), 'menu-bar-text-attributes.h'))
    },
    generateBundle() {
      if (process.platform !== 'darwin') return
      const include = resolve(dirname(realpathSync(process.execPath)), '../include/node')
      if (!existsSync(join(include, 'node_api.h'))) {
        throw new Error('菜单栏文字描边需要 Node-API 头文件，请使用包含开发头文件的 Node.js 安装。')
      }
      const directory = mkdtempSync(join(tmpdir(), 'jianzhang-menu-bar-text-'))
      const output = join(directory, 'menu-bar-text.node')
      try {
        execFileSync(
          'xcrun',
          [
            'clang++',
            '-bundle',
            '-undefined',
            'dynamic_lookup',
            '-fobjc-arc',
            '-std=c++17',
            '-DNAPI_VERSION=8',
            '-mmacosx-version-min=11.0',
            '-arch',
            'arm64',
            '-arch',
            'x86_64',
            '-framework',
            'AppKit',
            '-I',
            include,
            source,
            '-o',
            output
          ],
          { stdio: 'inherit' }
        )
        this.emitFile({
          type: 'asset',
          fileName: 'menu-bar-text.node',
          source: readFileSync(output)
        })
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  }
}
