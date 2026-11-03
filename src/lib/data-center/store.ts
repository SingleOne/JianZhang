export type Equality<T> = (previous: T, next: T) => boolean

/** A window-local snapshot. Commit the whole batch before notifying subscribers. */
export function createSnapshotStore<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    publish(next: T) {
      if (Object.is(snapshot, next)) return
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
    select<Value>(selector: (snapshot: T) => Value, equal: Equality<Value> = Object.is) {
      let source = snapshot
      let value = selector(source)
      const getSnapshot = () => {
        if (source !== snapshot) {
          source = snapshot
          const next = selector(source)
          if (!equal(value, next)) value = next
        }
        return value
      }
      return {
        getSnapshot,
        subscribe(listener: () => void) {
          let observed = getSnapshot()
          const changed = () => {
            const next = getSnapshot()
            if (Object.is(observed, next)) return
            observed = next
            listener()
          }
          listeners.add(changed)
          return () => {
            listeners.delete(changed)
          }
        }
      }
    }
  }
}
