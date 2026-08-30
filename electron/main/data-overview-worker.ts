import { parentPort, workerData } from 'node:worker_threads'
import { generateDividendFinancingOverview, generateFundamentalOverview } from './data-overview'

interface DataOverviewWorkerInput {
  kind: 'dividend-financing' | 'fundamental'
  dataDirectory: string
  snapshotPath: string
}

const input = workerData as DataOverviewWorkerInput

try {
  if (input.kind === 'fundamental') {
    generateFundamentalOverview(input.dataDirectory, input.snapshotPath)
  } else {
    generateDividendFinancingOverview(input.dataDirectory, input.snapshotPath)
  }
  parentPort?.postMessage({ ok: true })
} catch (reason) {
  parentPort?.postMessage({
    ok: false,
    error: reason instanceof Error ? reason.message : '轻量概览生成失败'
  })
}
