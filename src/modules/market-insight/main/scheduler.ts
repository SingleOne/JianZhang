export class LayeredRefreshScheduler {
  private readonly nextRefreshAt = new Map<string, number>()

  shouldRefresh(quoteId: string, dataType: string, interval: number, force = false): boolean {
    const key = `${quoteId}:${dataType}`
    const now = Date.now()
    if (!force && (this.nextRefreshAt.get(key) ?? 0) > now) return false
    this.nextRefreshAt.set(key, now + interval)
    return true
  }

  clear(quoteId?: string): void {
    if (!quoteId) {
      this.nextRefreshAt.clear()
      return
    }
    for (const key of this.nextRefreshAt.keys())
      if (key.startsWith(`${quoteId}:`)) this.nextRefreshAt.delete(key)
  }
}
