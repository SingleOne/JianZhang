import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedOutputOptions, PluginContext } from 'rollup'
import { macMenuBarTextPlugin } from '../../scripts/mac-menu-bar-text-plugin'

const { compile, exists, read, remove, emit } = vi.hoisted(() => ({
  compile: vi.fn(),
  exists: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
  emit: vi.fn()
}))
vi.mock('node:child_process', () => ({ execFileSync: compile }))
vi.mock('node:fs', () => ({
  existsSync: exists,
  mkdtempSync: () => '/tmp/jianzhang-menu-bar-text-test',
  readFileSync: read,
  realpathSync: () => '/node/bin/node',
  rmSync: remove
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  exists.mockReturnValue(true)
  read.mockReturnValue(Buffer.from('native-addon'))
  compile.mockReset()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
})

function generate() {
  const hook = macMenuBarTextPlugin('/project/electron/native/menu-bar-text.mm').generateBundle!
  const handler = typeof hook === 'function' ? hook : hook.handler
  return handler.call(
    { emitFile: emit } as unknown as PluginContext,
    {} as NormalizedOutputOptions,
    {},
    false
  )
}

describe('native menu bar addon build integration', () => {
  it('emits a universal Node-API addon in the main bundle and removes temporary files', () => {
    generate()
    expect(compile).toHaveBeenCalledWith(
      'xcrun',
      expect.arrayContaining([
        'clang++',
        '-arch',
        'arm64',
        'x86_64',
        '-DNAPI_VERSION=8',
        '/project/electron/native/menu-bar-text.mm'
      ]),
      { stdio: 'inherit' }
    )
    expect(emit).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'menu-bar-text.node',
      source: Buffer.from('native-addon')
    })
    expect(remove).toHaveBeenCalledWith('/tmp/jianzhang-menu-bar-text-test', {
      recursive: true,
      force: true
    })
  })

  it('does not compile or emit a macOS addon on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    generate()
    expect(compile).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('fails the build when compilation fails and still removes temporary files', () => {
    compile.mockImplementation(() => {
      throw new Error('compile failed')
    })
    expect(generate).toThrow('compile failed')
    expect(emit).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('/tmp/jianzhang-menu-bar-text-test', {
      recursive: true,
      force: true
    })
  })
})
