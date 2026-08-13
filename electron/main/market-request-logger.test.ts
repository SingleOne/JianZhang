import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MarketRequestLogger } from './market-request-logger'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'jianzhang-market-log-'))
  directories.push(directory)
  return directory
}

describe('MarketRequestLogger', () => {
  it('samples successful requests and flushes buffered logs on dispose', async () => {
    const directory = temporaryDirectory()
    const logger = new MarketRequestLogger(directory)
    for (let index = 0; index < 20; index += 1) {
      await logger.track(
        { dataType: 'quote', caller: 'test', source: 'test' },
        async () => ['quote'],
        (value) => value.length
      )
    }
    logger.dispose()

    const files = readdirSync(directory)
    expect(files).toHaveLength(1)
    const content = readFileSync(join(directory, files[0]), 'utf8')
    expect(content.trim().split(/\r?\n/)).toHaveLength(1)
  })

  it('always logs failures', async () => {
    const directory = temporaryDirectory()
    const logger = new MarketRequestLogger(directory)
    await expect(
      logger.track({ dataType: 'quote', caller: 'test', source: 'test' }, async () => {
        throw new Error('network failed')
      })
    ).rejects.toThrow('network failed')
    logger.dispose()

    const path = join(directory, readdirSync(directory)[0])
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).size).toBeGreaterThan(0)
    expect(readFileSync(path, 'utf8')).toContain('network failed')
  })
})
