import { BrowserWindow, nativeImage, type NativeImage } from 'electron'

interface TitleFrameRequest {
  title: string
  previousTitle: string | null
  titles: string[]
  minimumWidth: number
  dark: boolean
  icon: string
}

// This function runs in an isolated, hidden renderer. All content is drawn as text,
// never interpreted as HTML; only the resulting local PNGs leave the renderer.
async function rasterizeTitleFrames(request: TitleFrameRequest): Promise<string[][]> {
  const foreground = request.dark ? '#ffffff' : '#1d1d1f'
  const colors = {
    '31': request.dark ? '#ff6b75' : '#c92733',
    '32': request.dark ? '#51d39e' : '#087c57'
  }
  const segments = (title: string) => {
    const parts = title.split('\u001b[')
    return parts.map((part, index) => {
      if (index === 0) return { text: part, color: foreground }
      const end = part.indexOf('m')
      return {
        text: part.slice(end + 1),
        color: colors[part.slice(0, end) as keyof typeof colors] ?? foreground
      }
    })
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const font = '13px -apple-system, BlinkMacSystemFont, sans-serif'
  context.font = font
  const digitWidth = Math.max(
    ...Array.from('0123456789', (digit) => context.measureText(digit).width)
  )
  const charWidth = (char: string) =>
    /[0-9]/.test(char) ? digitWidth : context.measureText(char).width
  const textWidth = (title: string) =>
    segments(title).reduce(
      (width, segment) =>
        width + Array.from(segment.text).reduce((sum, char) => sum + charWidth(char), 0),
      0
    )
  const width = Math.max(
    request.minimumWidth,
    Math.ceil(
      Math.max(
        ...request.titles.map(textWidth),
        textWidth(request.title),
        textWidth(request.previousTitle ?? '')
      )
    ) + 24
  )
  const icon = new Image()
  icon.src = request.icon
  await icon.decode()
  const frames: string[][] = []
  const steps = request.previousTitle === null ? 0 : 18
  for (let frame = 0; frame <= steps; frame += 1) {
    const progress = steps === 0 ? 1 : 1 - (1 - frame / steps) ** 3
    const representations: string[] = []
    for (const scale of [1, 2]) {
      canvas.width = width * scale
      canvas.height = 22 * scale
      context.scale(scale, scale)
      context.drawImage(icon, 0, 3, 16, 16)
      context.globalCompositeOperation = 'source-in'
      context.fillStyle = foreground
      context.fillRect(0, 0, 16, 22)
      context.globalCompositeOperation = 'source-over'
      context.font = font
      context.textBaseline = 'middle'
      const draw = (title: string, opacity: number, offset: number) => {
        context.globalAlpha = opacity
        let x = 22
        for (const segment of segments(title)) {
          context.fillStyle = segment.color
          for (const char of segment.text) {
            const advance = charWidth(char)
            context.fillText(char, x + (advance - context.measureText(char).width) / 2, 11 + offset)
            x += advance
          }
        }
      }
      if (request.previousTitle !== null) draw(request.previousTitle, 1 - progress, -6 * progress)
      draw(request.title, progress, 6 * (1 - progress))
      representations.push(canvas.toDataURL('image/png'))
    }
    frames.push(representations)
  }
  return frames
}

export class MenuBarTitleRenderer {
  private window: BrowserWindow | null = null
  private ready: Promise<void> | null = null

  async render(request: TitleFrameRequest): Promise<NativeImage[]> {
    if (!this.window) {
      this.window = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        skipTaskbar: true,
        focusable: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      this.ready = this.window.loadURL(
        'data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">'
      )
    }
    const window = this.window
    await this.ready
    if (window.isDestroyed()) return []
    const frames: string[][] = await window.webContents.executeJavaScript(
      `(${rasterizeTitleFrames.toString()})(${JSON.stringify(request)})`
    )
    return frames.map((representations) => {
      const image = nativeImage.createEmpty()
      representations.forEach((dataURL, index) =>
        image.addRepresentation({ scaleFactor: index + 1, dataURL })
      )
      return image
    })
  }

  dispose(): void {
    this.window?.destroy()
    this.window = null
    this.ready = null
  }
}
