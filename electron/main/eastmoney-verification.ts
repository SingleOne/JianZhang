import { BrowserWindow, type Session } from 'electron'
import { BROWSER_USER_AGENT } from './http-user-agent'

const CHECK_INTERVAL = 60_000
const PAGE_CHECK_TIMEOUT = 15_000
const RECOVERY_CHECK_INTERVAL = 5_000
const VERIFICATION_MESSAGE =
  '东方财富需要安全验证，请在弹出的官方页面手动完成滑动验证，完成后将自动恢复行情。'

export function isEastmoneyUrl(value: string): boolean {
  const url = new URL(value)
  return (
    url.protocol === 'https:' &&
    (url.hostname === 'eastmoney.com' || url.hostname.endsWith('.eastmoney.com'))
  )
}

export function hasEastmoneyChallenge(text: string): boolean {
  const title = text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  // Normal quote pages can include hidden verification templates in their scripts.
  const prompt = title ? title[1] : text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  return /(?:安全|访问|人机|滑动|滑块)验证|(?:拖动|滑动|按住)[^\n<>]{0,40}滑块|请[^\n<>]{0,20}完成验证/i.test(
    prompt
  )
}

export function eastmoneyVerificationPageUrl(requestUrl: string): string {
  const url = new URL(requestUrl)
  if (url.hostname === 'quote.eastmoney.com') return url.toString()
  if (url.hostname === 'datacenter-web.eastmoney.com') return 'https://data.eastmoney.com/'
  if (url.hostname === 'emweb.eastmoney.com') {
    const page = new URL('https://emweb.eastmoney.com/PC_HSF10/ShareholderResearch/Index')
    const code = url.searchParams.get('code')
    if (code) page.searchParams.set('code', code)
    return page.toString()
  }
  const quoteId = url.searchParams.get('secid') ?? url.searchParams.get('secids')?.split(',')[0]
  return quoteId
    ? `https://quote.eastmoney.com/unify/r/${encodeURIComponent(quoteId)}`
    : 'https://quote.eastmoney.com/center/gridlist.html#hs_a_board'
}

export function hasEastmoneyResponseData(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as {
    rc?: number
    success?: boolean
    data?: unknown
    result?: { data?: unknown[] }
    QuotationCodeTable?: { Data?: unknown[] }
    gdrs?: unknown[]
    sdgd?: unknown[]
  }
  if (value.success === false || (typeof value.rc === 'number' && value.rc !== 0)) return false
  const data = value.data
  if (Array.isArray(data)) return data.length > 0
  if (data && typeof data === 'object') {
    const rows = data as {
      diff?: unknown[]
      klines?: unknown[]
      trends?: unknown[]
      data?: unknown[]
    }
    const list = rows.diff ?? rows.klines ?? rows.trends ?? rows.data
    return list ? list.length > 0 : Object.keys(data).length > 0
  }
  return Boolean(
    value.result?.data?.length ||
    value.QuotationCodeTable?.Data?.length ||
    value.gdrs?.length ||
    value.sdgd?.length
  )
}

// Read only the visible verification prompt. The official page owns the slider and its interaction.
const CHALLENGE_VISIBLE_SCRIPT = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const prompt = document.body?.innerText ?? '';
  if (/(?:安全|访问|人机|滑动|滑块)验证|(?:拖动|滑动|按住)[^\\n]{0,40}滑块|请[^\\n]{0,20}完成验证/.test(prompt)) return true;
  return [...document.querySelectorAll(
    'iframe[src*="captcha"], iframe[src*="verify"], #nc_1_wrapper, .nc-container, .geetest_panel, .geetest_panel_box, .geetest_holder, [id*="captcha"], [class*="captcha"]'
  )].some(visible);
})()`

export interface EastmoneyVerificationOptions {
  getParentWindow: () => BrowserWindow | null
  onRequired: (message: string) => void
  onVerified: () => void
  onError: (message: string) => void
}

export class EastmoneyVerification {
  private options: EastmoneyVerificationOptions | null = null
  private window: BrowserWindow | null = null
  private lastCheckAt = -Infinity
  private verificationRequired = false
  private disposed = false

  constructor(private readonly getSession: () => Session) {}

  get required(): boolean {
    return this.verificationRequired
  }

  configure(options: EastmoneyVerificationOptions): void {
    this.options = options
  }

  check(requestUrl: string, confirmed = false, responseUrl?: string): void {
    if (!this.options || this.disposed || !isEastmoneyUrl(requestUrl)) return
    if (this.window) {
      if (confirmed) this.showVerification()
      return
    }
    if (!confirmed && Date.now() - this.lastCheckAt < CHECK_INTERVAL) return
    this.lastCheckAt = Date.now()

    const browserSession = this.getSession()
    const parent = this.options.getParentWindow()
    const window = new BrowserWindow({
      title: '东方财富安全验证 · 请手动拖动滑块',
      width: 1080,
      height: 780,
      minWidth: 720,
      minHeight: 560,
      show: false,
      autoHideMenuBar: true,
      ...(parent ? { parent } : {}),
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    this.window = window
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.setAudioMuted(true)
    const allowOfficialNavigation = (event: Electron.Event, url: string) => {
      if (!isEastmoneyUrl(url)) event.preventDefault()
    }
    window.webContents.on('will-navigate', allowOfficialNavigation)
    window.webContents.on('will-redirect', allowOfficialNavigation)
    window.webContents.on('page-title-updated', (event) => event.preventDefault())

    let checking = false
    let lastRecoveryCheckAt = 0
    let documentReady = false
    const timeout = setTimeout(() => {
      if (!this.verificationRequired && !window.isDestroyed()) window.destroy()
    }, PAGE_CHECK_TIMEOUT)
    const timer = setInterval(() => {
      if ((!documentReady && !this.verificationRequired) || checking || window.isDestroyed()) return
      checking = true
      void (async () => {
        if (!this.verificationRequired) {
          if (await window.webContents.mainFrame.executeJavaScript(CHALLENGE_VISIBLE_SCRIPT)) {
            this.showVerification()
          }
        } else if (Date.now() - lastRecoveryCheckAt >= RECOVERY_CHECK_INTERVAL) {
          lastRecoveryCheckAt = Date.now()
          // Only a successful data request confirms recovery, not a cookie change or closing the page.
          const response = await browserSession.fetch(requestUrl, {
            headers: { 'User-Agent': BROWSER_USER_AGENT, Referer: pageUrl },
            credentials: 'include',
            cache: 'no-store',
            signal: AbortSignal.timeout(8_000)
          })
          if (!response.ok) return
          const text = await response.text()
          if (hasEastmoneyChallenge(text)) return
          const recovered =
            new URL(requestUrl).hostname === 'quote.eastmoney.com'
              ? /var\s+quotedata\s*=/.test(text)
              : hasEastmoneyResponseData(JSON.parse(text))
          if (recovered && !window.isDestroyed()) {
            window.destroy()
            this.options?.onVerified()
          }
        }
      })()
        .catch(() => {
          // A failed page inspection or recovery probe leaves the current verification state unchanged.
        })
        .finally(() => {
          checking = false
        })
    }, 1_000)
    window.webContents.on('dom-ready', () => {
      documentReady = true
    })
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) documentReady = false
    })
    window.on('closed', () => {
      clearTimeout(timeout)
      clearInterval(timer)
      this.window = null
      this.verificationRequired = false
      this.lastCheckAt = Date.now()
    })
    const pageUrl =
      responseUrl && isEastmoneyUrl(responseUrl) && responseUrl !== requestUrl
        ? responseUrl
        : eastmoneyVerificationPageUrl(requestUrl)
    if (confirmed) this.showVerification()
    void window
      .loadURL(pageUrl, { userAgent: BROWSER_USER_AGENT })
      .catch((error: Error & { code?: string }) => {
        if (window.isDestroyed() || error.code === 'ERR_ABORTED') return
        if (this.verificationRequired)
          this.options?.onError('东方财富验证页面加载失败，请稍后重新刷新行情。')
        window.destroy()
      })
  }

  dispose(): void {
    this.disposed = true
    this.window?.destroy()
  }

  private showVerification(): void {
    if (!this.window || this.window.isDestroyed() || this.verificationRequired) return
    this.verificationRequired = true
    this.window.show()
    this.window.focus()
    this.options?.onRequired(VERIFICATION_MESSAGE)
  }
}
