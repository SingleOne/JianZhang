import type {
  OptionalModuleId,
  OptionalModulesState,
  OptionalModuleState
} from '../../src/shared/types'

interface OptionalModuleWaiter {
  resolve: () => void
  reject: (reason: Error) => void
}

function initialModuleState(enabled: boolean): OptionalModuleState {
  return {
    status: enabled ? 'initializing' : 'disabled',
    error: null
  }
}

export class OptionalModuleRuntime {
  private readonly state: OptionalModulesState
  private readonly waiters = new Map<OptionalModuleId, Set<OptionalModuleWaiter>>()
  private disposed = false

  constructor(
    enabled: Record<OptionalModuleId, boolean>,
    private readonly notifyState: (state: OptionalModulesState) => void
  ) {
    this.state = {
      marketInsight: initialModuleState(enabled.marketInsight),
      ai: initialModuleState(enabled.ai),
      aiTAdvice: initialModuleState(enabled.aiTAdvice)
    }
  }

  getState(): OptionalModulesState {
    return {
      marketInsight: { ...this.state.marketInsight },
      ai: { ...this.state.ai },
      aiTAdvice: { ...this.state.aiTAdvice }
    }
  }

  waitUntilReady(moduleId: OptionalModuleId): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('应用正在退出'))
    const state = this.state[moduleId]
    if (state.status === 'ready') return Promise.resolve()
    if (state.status === 'disabled') return Promise.reject(new Error('当前构建未启用此功能'))
    if (state.status === 'failed') return Promise.reject(new Error(state.error ?? '功能初始化失败'))
    return new Promise((resolve, reject) => {
      const waiters = this.waiters.get(moduleId) ?? new Set<OptionalModuleWaiter>()
      waiters.add({ resolve, reject })
      this.waiters.set(moduleId, waiters)
    })
  }

  markReady(moduleId: OptionalModuleId): void {
    this.state[moduleId] = { status: 'ready', error: null }
    this.finishWaiters(moduleId)
    this.notifyState(this.getState())
  }

  markFailed(moduleId: OptionalModuleId, reason: unknown): void {
    const message = reason instanceof Error ? reason.message : '功能初始化失败'
    this.state[moduleId] = { status: 'failed', error: message }
    this.finishWaiters(moduleId, new Error(message))
    this.notifyState(this.getState())
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const moduleId of this.waiters.keys()) {
      this.finishWaiters(moduleId, new Error('应用正在退出'))
    }
  }

  private finishWaiters(moduleId: OptionalModuleId, error?: Error): void {
    const waiters = this.waiters.get(moduleId)
    if (!waiters) return
    this.waiters.delete(moduleId)
    for (const waiter of waiters) {
      if (error) waiter.reject(error)
      else waiter.resolve()
    }
  }
}
