import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StopLossSnapshot } from '../shared/stop-loss'
const { get, onUpdate } = vi.hoisted(() => ({ get: vi.fn(), onUpdate: vi.fn() }))
vi.mock('./api', () => ({ stockApi: { getStopLossSnapshots: get, onStopLossUpdated: onUpdate } }))
import { subscribeStopLoss } from './stop-loss'

describe('stop loss subscription', () => {
  beforeEach(() => vi.resetAllMocks())
  it('does not let a slow initial read overwrite a newer event', async () => {
    let resolve!: (value: StopLossSnapshot[]) => void
    get.mockReturnValue(
      new Promise<StopLossSnapshot[]>((done) => {
        resolve = done
      })
    )
    let receive!: (value: StopLossSnapshot[]) => void
    onUpdate.mockImplementation((callback) => {
      receive = callback
      return () => {}
    })
    const listener = vi.fn()
    subscribeStopLoss(listener)
    const event = [] as StopLossSnapshot[]
    receive(event)
    resolve([])
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(event)
  })
  it('delivers the initial snapshot and unsubscribes without late delivery', async () => {
    get.mockResolvedValue([])
    const off = vi.fn()
    onUpdate.mockReturnValue(off)
    const listener = vi.fn()
    const unsubscribe = subscribeStopLoss(listener)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledWith([])
    unsubscribe()
    expect(off).toHaveBeenCalledOnce()
    listener.mockClear()
    get.mockResolvedValue([])
    subscribeStopLoss(listener)()
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
  })
})
