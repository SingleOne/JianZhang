import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from './store'

describe('snapshot subscriptions', () => {
  it('notifies only selections that changed and exposes the complete committed batch', () => {
    const store = createSnapshotStore({ a: 1, b: 2 })
    const a = store.select((value) => value.a)
    const b = store.select((value) => value.b)
    const onA = vi.fn(() => expect(store.getSnapshot()).toEqual({ a: 3, b: 2 }))
    const onB = vi.fn()
    a.subscribe(onA)
    b.subscribe(onB)
    store.publish({ a: 3, b: 2 })
    expect(onA).toHaveBeenCalledOnce()
    expect(onB).not.toHaveBeenCalled()
  })

  it('retains equal derived snapshots and gives late subscribers the latest value', () => {
    const store = createSnapshotStore({ value: 1, other: 0 })
    const selected = store.select(
      (s) => [s.value],
      (a, b) => a[0] === b[0]
    )
    const original = selected.getSnapshot()
    store.publish({ value: 1, other: 2 })
    expect(selected.getSnapshot()).toBe(original)
    store.publish({ value: 3, other: 2 })
    const listener = vi.fn()
    const unsubscribe = selected.subscribe(listener)
    expect(selected.getSnapshot()).toEqual([3])
    unsubscribe()
    store.publish({ value: 4, other: 2 })
    expect(listener).not.toHaveBeenCalled()
    expect(selected.getSnapshot()).toEqual([4])
  })
})
