import { net } from 'electron'

const SEC_REQUEST_INTERVAL_MILLISECONDS = 150
let nextSecRequestAt = 0
let secRequestSchedule: Promise<void> = Promise.resolve()

export class OfficialSourceHttpError extends Error {
  constructor(
    url: string,
    readonly status: number
  ) {
    super(`请求 ${new URL(url).hostname} 失败：HTTP ${status}`)
  }
}

async function waitForRequestSlot(url: string): Promise<void> {
  if (!['sec.gov', 'www.sec.gov', 'data.sec.gov'].includes(new URL(url).hostname)) return
  const scheduled = secRequestSchedule.then(async () => {
    const waitMilliseconds = Math.max(0, nextSecRequestAt - Date.now())
    if (waitMilliseconds > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMilliseconds))
    }
    nextSecRequestAt = Date.now() + SEC_REQUEST_INTERVAL_MILLISECONDS
  })
  secRequestSchedule = scheduled
  await scheduled
}

async function requestOfficialSource<T>(
  url: string,
  init: RequestInit,
  timeoutMilliseconds: number,
  read: (response: Response) => Promise<T>
): Promise<T> {
  const send = async (fetcher: (input: string, options: RequestInit) => Promise<Response>) => {
    init.signal?.throwIfAborted()
    await waitForRequestSlot(url)
    init.signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(timeoutMilliseconds)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return fetcher(url, { ...init, signal })
  }
  let response: Response | undefined
  try {
    response = await send((...args) => net.fetch(...args))
    if (response.status !== 403) return await read(response)
    await response.body?.cancel()
  } catch (error) {
    if (init.signal?.aborted) throw error
    // HTTP errors other than 403 remain visible; JSON parsing happens outside this helper.
    if (response && !response.ok && response.status !== 403) throw error
  }
  // Chromium uses system proxy/PAC settings. Try Node's independent connection once
  // when that route is denied or fails, preserving the source's headers and payload.
  return read(await send(fetch))
}

export function fetchOfficialSource(
  url: string,
  init: RequestInit = {},
  timeoutMilliseconds = 15_000
): Promise<Response> {
  return requestOfficialSource(url, init, timeoutMilliseconds, async (response) => response)
}

export function requestOfficialSourceBytes(
  url: string,
  init: RequestInit = {},
  timeoutMilliseconds = 15_000
): Promise<{ bytes: Uint8Array; contentType: string }> {
  return requestOfficialSource(url, init, timeoutMilliseconds, async (response) => {
    if (!response.ok) throw new OfficialSourceHttpError(url, response.status)
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? ''
    }
  })
}
