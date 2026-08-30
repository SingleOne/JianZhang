import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

interface DataOverviewWorkerResult {
  ok: boolean
  error?: string
}

export function generateDataOverviewInWorker(
  kind: 'dividend-financing' | 'fundamental',
  dataDirectory: string,
  snapshotPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }
    const worker = new Worker(join(__dirname, 'data-overview-worker.js'), {
      workerData: { kind, dataDirectory, snapshotPath }
    })
    worker.unref()
    worker.once('message', (result: DataOverviewWorkerResult) => {
      finish(() => {
        if (result.ok) resolve()
        else reject(new Error(result.error ?? '轻量概览生成失败'))
      })
    })
    worker.once('error', (reason) => finish(() => reject(reason)))
    worker.once('exit', (code) => {
      if (!settled) finish(() => reject(new Error(`轻量概览 Worker 已退出（${code}）`)))
    })
  })
}
