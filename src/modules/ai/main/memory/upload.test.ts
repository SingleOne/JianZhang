import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { uploadBytes } from './upload'

test('D1.3 socket byte progress is monotonic and HTTP 202 carries a durable processing job', async () => {
  const expected = Buffer.alloc(700000, 42)
  const server = createServer(async (incoming, response) => {
    const parts: Buffer[] = []
    for await (const part of incoming) parts.push(Buffer.from(part))
    assert.deepEqual(Buffer.concat(parts), expected)
    assert.equal(incoming.headers.prefer, 'respond-async')
    response.writeHead(202, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'document', processingJob: { id: 'job', kind: 'import' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    const sent: number[] = []
    const bytes = Uint8Array.from(expected).buffer
    const result = await uploadBytes(
      new URL(`http://127.0.0.1:${address.port}/upload`),
      { prefer: 'respond-async', 'x-operation-id': 'stable-id' },
      bytes,
      (n) => sent.push(n)
    )
    assert.equal(result.processingJob?.id, 'job')
    assert.equal(sent.at(-1), expected.length)
    assert.ok(sent.every((value, index) => index === 0 || value > sent[index - 1]))
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
