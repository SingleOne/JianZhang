import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PythonTaskQueue } from './python-task-queue'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
const script = '/app/scripts/update.py'
const notify = vi.fn()
const output = vi.fn()
const onStart = vi.fn()
let results: Record<string, number | string>

function platform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

beforeEach(() => {
  platform('darwin')
  results = {}
  spawn.mockReset().mockImplementation((command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough()
    })
    queueMicrotask(() => {
      const result = results[command] ?? 'ENOENT'
      if (typeof result === 'string') {
        child.emit('error', Object.assign(new Error(result), { code: result }))
        child.emit('close', -2)
      } else if (args.includes('-c')) {
        child.emit('close', result)
      } else {
        child.stdout.write('snapshot ready\n')
        child.emit('close', 0)
      }
    })
    return child
  })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor)
})

function run(queue = new PythonTaskQueue(notify)): Promise<void> {
  return queue.run(script, ['--output', '/data/snapshot.json'], output, onStart)
}

describe('Python environment detection', () => {
  it('runs updates with python3 when python and the Windows launcher are absent', async () => {
    results.python3 = 0

    await run()

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenLastCalledWith(
      'python3',
      [script, '--output', '/data/snapshot.json'],
      expect.objectContaining({
        cwd: '/app/scripts',
        env: expect.objectContaining({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' })
      })
    )
    expect(output).toHaveBeenCalledWith('snapshot ready\n')
    expect(onStart).toHaveBeenCalledOnce()
    expect(notify).not.toHaveBeenCalled()
  })

  it.each([
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
    '/usr/bin/python3'
  ])('finds %s when a Finder launch cannot resolve Python from PATH', async (command) => {
    results[command] = 0

    await run()

    expect(spawn).toHaveBeenLastCalledWith(
      command,
      [script, '--output', '/data/snapshot.json'],
      expect.any(Object)
    )
  })

  it('keeps the Windows Python 3 launcher and its arguments', async () => {
    platform('win32')
    results.py = 0

    await run()

    expect(spawn).toHaveBeenLastCalledWith(
      'py',
      ['-3', script, '--output', '/data/snapshot.json'],
      expect.any(Object)
    )
  })

  it('falls back to python3 on Windows when the launcher is missing', async () => {
    platform('win32')
    results.python3 = 0

    await run()

    expect(spawn.mock.calls.map(([command]) => command)).toEqual(['py', 'python3', 'python3'])
  })

  it.each([
    ['darwin', '/data/Application Support/python-env/bin/python3'],
    ['win32', '/data/Application Support/python-env/Scripts/python.exe']
  ] as const)(
    'prefers the app environment on %s, preserving paths with spaces',
    async (os, python) => {
      platform(os)
      results[python] = 0
      results.python3 = 0

      await run(new PythonTaskQueue(notify, '/data/Application Support/python-env'))

      expect(spawn.mock.calls.map(([command]) => command)).toEqual([python, python])
    }
  )

  it('continues searching when the first Python 3 lacks requests', async () => {
    results.python3 = 3
    results['/opt/homebrew/bin/python3'] = 0

    await run()

    expect(spawn).toHaveBeenLastCalledWith(
      '/opt/homebrew/bin/python3',
      expect.arrayContaining([script]),
      expect.any(Object)
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects Python 2 instead of reporting a missing requests dependency', async () => {
    results.python = 2

    await expect(run()).rejects.toMatchObject({ kind: 'python-missing' })

    const probeArgs = spawn.mock.calls.find(([command]) => command === 'python')![1] as string[]
    expect(probeArgs.at(-1)).toContain('sys.version_info[0] != 3')
    expect(notify).toHaveBeenCalledOnce()
  })

  it('does not mistake an unlaunchable executable for a usable Python', async () => {
    results.python3 = 'EACCES'

    await expect(run()).rejects.toMatchObject({ kind: 'python-missing' })
  })

  it('does not mistake a failed launcher for Python with missing requests', async () => {
    results.python3 = 1

    await expect(run()).rejects.toMatchObject({ kind: 'python-missing' })
  })

  it('suggests an isolated environment when requests is absent from a managed Python', async () => {
    results['/opt/homebrew/bin/python3'] = 3

    await expect(
      run(new PythonTaskQueue(notify, '/data/Application Support/python-env'))
    ).rejects.toMatchObject({
      kind: 'requests-missing',
      message: expect.stringContaining(
        "/opt/homebrew/bin/python3 -m venv '/data/Application Support/python-env'\n'/data/Application Support/python-env/bin/python3' -m pip install requests"
      )
    })
    expect(spawn.mock.calls.every(([, args]) => (args as string[]).includes('-c'))).toBe(true)
  })

  it('only suggests installing requests when the app environment already exists', async () => {
    results['/data/python-env/bin/python3'] = 3

    await expect(run(new PythonTaskQueue(notify, '/data/python-env'))).rejects.toMatchObject({
      kind: 'requests-missing',
      message: expect.stringContaining('/data/python-env/bin/python3 -m pip install requests')
    })
    expect(notify.mock.calls[0][0]).not.toContain('-m venv')
  })

  it('uses py -3 in the Windows installation hint when that is the detected runtime', async () => {
    platform('win32')
    results.py = 3

    await expect(run()).rejects.toMatchObject({
      kind: 'requests-missing',
      message: expect.stringContaining('py -3 -m pip install requests')
    })
  })

  it('rechecks dependencies on retry, deduplicates warnings, and recovers the queue', async () => {
    const queue = new PythonTaskQueue(notify)
    results.python3 = 3

    await expect(run(queue)).rejects.toMatchObject({ kind: 'requests-missing' })
    await expect(run(queue)).rejects.toMatchObject({ kind: 'requests-missing' })
    expect(notify).toHaveBeenCalledOnce()

    results.python3 = 0
    await run(queue)
    expect(output).toHaveBeenCalledWith('snapshot ready\n')

    results.python3 = 3
    await expect(run(queue)).rejects.toMatchObject({ kind: 'requests-missing' })
    expect(notify).toHaveBeenCalledTimes(2)
  })
})
