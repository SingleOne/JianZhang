import { mkdirSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const outputSize = 256
const scale = 4
const size = outputSize * scale
const red = [220, 55, 66]
const white = [255, 255, 255]
const black = [17, 17, 17]

function isInsideRoundedSquare(x, y) {
  const inset = 0
  const radius = 54 * scale
  const left = inset
  const top = inset
  const right = size - inset - 1
  const bottom = size - inset - 1
  const nearestX = Math.max(left + radius, Math.min(x, right - radius))
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius))
  const dx = x - nearestX
  const dy = y - nearestY
  return x >= left && x <= right && y >= top && y <= bottom && dx * dx + dy * dy <= radius * radius
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1
  const vy = y2 - y1
  const wx = px - x1
  const wy = py - y1
  const lengthSquared = vx * vx + vy * vy
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared))
  const dx = px - (x1 + t * vx)
  const dy = py - (y1 + t * vy)
  return Math.sqrt(dx * dx + dy * dy)
}

function renderIcon(background, foreground) {
  const pixels = new Uint8ClampedArray(size * size * 4)

  function setPixel(x, y, color, alpha = 255) {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const offset = (y * size + x) * 4
    pixels[offset] = color[0]
    pixels[offset + 1] = color[1]
    pixels[offset + 2] = color[2]
    pixels[offset + 3] = alpha
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (isInsideRoundedSquare(x, y)) setPixel(x, y, background)
    }
  }

  const points = [
    [64, 174],
    [105, 139],
    [135, 158],
    [192, 91]
  ].map(([x, y]) => [x * scale, y * scale])
  const stroke = 9 * scale

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const onLine = points
        .slice(0, -1)
        .some(
          (point, index) =>
            distanceToSegment(
              x,
              y,
              point[0],
              point[1],
              points[index + 1][0],
              points[index + 1][1]
            ) <= stroke
        )
      const onArrowA =
        distanceToSegment(x, y, 192 * scale, 91 * scale, 158 * scale, 94 * scale) <= stroke
      const onArrowB =
        distanceToSegment(x, y, 192 * scale, 91 * scale, 189 * scale, 125 * scale) <= stroke
      if (onLine || onArrowA || onArrowB) setPixel(x, y, foreground)
    }
  }

  const png = new PNG({ width: outputSize, height: outputSize })
  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      const totals = [0, 0, 0, 0]
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const source = ((y * scale + sy) * size + (x * scale + sx)) * 4
          for (let channel = 0; channel < 4; channel += 1)
            totals[channel] += pixels[source + channel]
        }
      }
      const destination = (y * outputSize + x) * 4
      for (let channel = 0; channel < 4; channel += 1)
        png.data[destination + channel] = totals[channel] / (scale * scale)
    }
  }

  return PNG.sync.write(png)
}

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', renderIcon(red, white))
writeFileSync('build/icon-white.png', renderIcon(white, red))
writeFileSync('build/icon-black.png', renderIcon(black, red))
