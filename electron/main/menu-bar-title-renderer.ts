import { BrowserWindow, nativeImage, type NativeImage } from 'electron'

interface TitleFrameRequest {
  title: string
  previousTitle: string | null
  titles: string[]
  minimumWidth: number
  icon: string
}

// This function runs in an isolated, hidden renderer. All content is drawn as text,
// never interpreted as HTML; only the resulting local PNGs leave the renderer.
async function rasterizeTitleFrames(request: TitleFrameRequest): Promise<string[][]> {
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
    Array.from(title).reduce((width, char) => width + charWidth(char), 0)
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
      context.fillStyle = '#000000'
      context.fillRect(0, 0, 16, 22)
      context.globalCompositeOperation = 'source-over'
      context.font = font
      context.textBaseline = 'middle'
      context.strokeStyle = '#000000'
      context.lineWidth = 0.5
      context.lineJoin = 'round'
      const draw = (title: string, opacity: number, offset: number) => {
        context.globalAlpha = opacity
        let x = 22
        for (const char of title) {
          const advance = charWidth(char)
          const glyphX = x + (advance - context.measureText(char).width) / 2
          context.strokeText(char, glyphX, 11 + offset)
          context.fillText(char, glyphX, 11 + offset)
          x += advance
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
      // macOS resolves the neutral icon/name against the actual menu bar background,
      // including wallpaper changes that do not change the system's dark mode.
      image.setTemplateImage(true)
      return image
    })
  }

  dispose(): void {
    this.window?.destroy()
    this.window = null
    this.ready = null
  }
}
