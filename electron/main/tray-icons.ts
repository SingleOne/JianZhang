import { nativeImage, type NativeImage } from 'electron'
import { PNG } from 'pngjs'

type Color = [number, number, number, number]

function setPixel(png: PNG, x: number, y: number, color: Color): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return
  const offset = (png.width * y + x) << 2
  png.data[offset] = color[0]
  png.data[offset + 1] = color[1]
  png.data[offset + 2] = color[2]
  png.data[offset + 3] = color[3]
}

function fillRoundedSquare(png: PNG, color: Color): void {
  const radius = 6
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const dx =
        x < radius ? radius - x : x >= png.width - radius ? x - (png.width - radius - 1) : 0
      const dy =
        y < radius ? radius - y : y >= png.height - radius ? y - (png.height - radius - 1) : 0
      if (dx * dx + dy * dy <= radius * radius) setPixel(png, x, y, color)
    }
  }
}

export function createAppIcon(): NativeImage {
  const png = new PNG({ width: 32, height: 32 })
  const red: Color = [220, 55, 66, 255]
  const white: Color = [255, 255, 255, 255]
  const black: Color = [17, 17, 17, 255]
  const backgrounds = { white, red, black }
  const foreground = __JIANZHANG_ICON_VARIANT__ === 'red' ? white : red
  const background = backgrounds[__JIANZHANG_ICON_VARIANT__]
  const guide: Color = [foreground[0], foreground[1], foreground[2], 90]
  fillRoundedSquare(png, background)

  for (let x = 7; x <= 24; x += 1) setPixel(png, x, 24, guide)
  const points = [
    [7, 22],
    [8, 21],
    [9, 20],
    [10, 19],
    [11, 20],
    [12, 21],
    [13, 19],
    [14, 17],
    [15, 18],
    [16, 16],
    [17, 14],
    [18, 15],
    [19, 13],
    [20, 11],
    [21, 12],
    [22, 9],
    [23, 8],
    [24, 7]
  ]
  for (const [x, y] of points) {
    setPixel(png, x, y, foreground)
    setPixel(png, x, y + 1, foreground)
  }
  for (let y = 7; y <= 12; y += 1) setPixel(png, 24, y, foreground)
  for (let x = 20; x <= 24; x += 1) setPixel(png, x, 7, foreground)

  return nativeImage.createFromBuffer(PNG.sync.write(png))
}

export function createMenuBarIcon(): NativeImage {
  const image = nativeImage.createEmpty()
  for (const scale of [1, 2]) {
    const png = new PNG({ width: 16 * scale, height: 16 * scale })
    const black: Color = [0, 0, 0, 255]
    const points = [
      [2, 12],
      [6, 8],
      [9, 10],
      [14, 3]
    ]
    for (let index = 1; index < points.length; index += 1) {
      const [startX, startY] = points[index - 1]
      const [endX, endY] = points[index]
      const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY)) * scale
      for (let step = 0; step <= steps; step += 1) {
        const x = Math.round((startX + ((endX - startX) * step) / steps) * scale)
        const y = Math.round((startY + ((endY - startY) * step) / steps) * scale)
        for (let offsetX = 0; offsetX < scale; offsetX += 1) {
          for (let offsetY = 0; offsetY < scale; offsetY += 1) {
            setPixel(png, x + offsetX, y + offsetY, black)
          }
        }
      }
    }
    for (let coordinate = 10 * scale; coordinate <= 14 * scale; coordinate += 1) {
      for (let offset = 0; offset < scale; offset += 1) {
        setPixel(png, coordinate, 3 * scale + offset, black)
        setPixel(png, 14 * scale + offset, coordinate - 7 * scale, black)
      }
    }
    image.addRepresentation({ scaleFactor: scale, buffer: PNG.sync.write(png) })
  }
  image.setTemplateImage(true)
  return image
}
