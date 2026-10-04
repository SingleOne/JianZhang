import { request } from 'node:http'
import type { MemoryDocument } from '../../shared/memory-types'

// Progress means bytes handed to the local socket, not server-side durable acceptance.
export function uploadBytes(
  url: URL,
  headers: Record<string, string>,
  bytes: ArrayBuffer,
  onSent: (sentBytes: number) => void
): Promise<MemoryDocument> {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.from(bytes)
    const outgoing = request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': String(buffer.length) },
        signal: AbortSignal.timeout(120000)
      },
      (response) => {
        const parts: Buffer[] = []
        response.on('data', (part: Buffer) => parts.push(part))
        response.on('error', reject)
        response.on('aborted', () => reject(new Error('上传响应中断，请重选同一文件重试')))
        response.on('end', () => {
          try {
            const result = JSON.parse(Buffer.concat(parts).toString('utf8')) as MemoryDocument & {
              error?: string
            }
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300)
              throw new Error(`记忆服务 ${response.statusCode}: ${result.error ?? '上传失败'}`)
            if (response.statusCode === 202 && !result.processingJob)
              throw new Error('记忆服务没有返回持久处理任务')
            resolve(result)
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    outgoing.on('error', reject)
    let offset = 0
    const sendNext = () => {
      if (outgoing.destroyed) return
      if (offset === buffer.length) {
        outgoing.end()
        return
      }
      const end = Math.min(offset + 256 * 1024, buffer.length)
      outgoing.write(buffer.subarray(offset, end), (error?: Error | null) => {
        if (error) {
          outgoing.destroy(error)
          return
        }
        offset = end
        try {
          onSent(offset)
        } catch (error) {
          outgoing.destroy(error instanceof Error ? error : new Error('上传身份已变化'))
          return
        }
        sendNext()
      })
    }
    sendNext()
  })
}
