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
      const dx = x < radius ? radius - x : x >= png.width - radius ? x - (png.width - radius - 1) : 0
      const dy = y < radius ? radius - y : y >= png.height - radius ? y - (png.height - radius - 1) : 0
      if (dx * dx + dy * dy <= radius * radius) setPixel(png, x, y, color)
    }
  }
}

export function createAppIcon(): NativeImage {
  const png = new PNG({ width: 32, height: 32 })
  fillRoundedSquare(png, [37, 99, 235, 255])
  const white: Color = [255, 255, 255, 255]

  for (let x = 7; x <= 24; x += 1) setPixel(png, x, 24, [255, 255, 255, 90])
  const points = [
    [7, 22], [8, 21], [9, 20], [10, 19], [11, 20], [12, 21], [13, 19],
    [14, 17], [15, 18], [16, 16], [17, 14], [18, 15], [19, 13], [20, 11],
    [21, 12], [22, 9], [23, 8], [24, 7]
  ]
  for (const [x, y] of points) {
    setPixel(png, x, y, white)
    setPixel(png, x, y + 1, white)
  }
  for (let y = 7; y <= 12; y += 1) setPixel(png, 24, y, white)
  for (let x = 20; x <= 24; x += 1) setPixel(png, x, 7, white)

  return nativeImage.createFromBuffer(PNG.sync.write(png))
}
