import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  }

  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const ACCENT = [29, 111, 90]

function render(size) {
  const SS = 3
  const buf = Buffer.alloc(size * size * 4)
  const half = size / 2
  const pad = size * 0.055
  const inner = half - pad
  const radius = size * 0.22
  const starScale = size * 0.3

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sr = 0
      let sg = 0
      let sb = 0
      let covered = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS

          const dx = Math.max(Math.abs(px - half) - (inner - radius), 0)
          const dy = Math.max(Math.abs(py - half) - (inner - radius), 0)
          if (dx * dx + dy * dy > radius * radius) continue

          const nx = (px - half) / starScale
          const ny = (py - half) / starScale
          const isStar = Math.sqrt(Math.abs(nx)) + Math.sqrt(Math.abs(ny)) <= 1

          if (isStar) {
            sr += 255
            sg += 255
            sb += 255
          } else {
            sr += ACCENT[0]
            sg += ACCENT[1]
            sb += ACCENT[2]
          }
          covered++
        }
      }

      const idx = (y * size + x) * 4
      if (!covered) continue
      buf[idx] = Math.round(sr / covered)
      buf[idx + 1] = Math.round(sg / covered)
      buf[idx + 2] = Math.round(sb / covered)
      buf[idx + 3] = Math.round((255 * covered) / (SS * SS))
    }
  }

  return buf
}

const outDir = path.join(process.cwd(), 'build')
fs.mkdirSync(outDir, { recursive: true })

for (const [name, size] of [
  ['icon.png', 512],
  ['tray.png', 32]
]) {
  const png = encodePng(size, render(size))
  fs.writeFileSync(path.join(outDir, name), png)
  console.log(`${name}: ${size}x${size}, ${png.length} bytes`)
}
