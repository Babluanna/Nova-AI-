import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([lenBuf, combined, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0; // filter type 0 (None)
    rgba.copy(raw, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function renderNovaIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const half = size / 2;
  // Safe zone scale: maskable icons keep emblem well within central 72% circle
  const emblemScale = maskable ? 0.27 : 0.33;
  const ringRadius = size * (maskable ? 0.25 : 0.30);
  const cornerRadius = maskable ? 0 : size * 0.225;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = x / (size - 1);
      const ny = y / (size - 1);

      // Rounded rect alpha for non-maskable icons (with 1px AA)
      let bgAlpha = 1;
      if (!maskable) {
        const dx = Math.max(Math.abs(x + 0.5 - half) - (half - cornerRadius), 0);
        const dy = Math.max(Math.abs(y + 0.5 - half) - (half - cornerRadius), 0);
        const distCorner = Math.hypot(dx, dy) - cornerRadius;
        bgAlpha = clamp01(0.5 - distCorner);
      }

      if (bgAlpha <= 0) {
        rgba[idx + 3] = 0;
        continue;
      }

      // Deep iOS midnight-to-cobalt gradient background
      const gradT = clamp01((nx * 0.45 + ny * 0.75) / 1.1);
      let r = lerp(11, 29, gradT);
      let g = lerp(15, 78, gradT);
      let b = lerp(25, 216, gradT);

      // Subtle radial glow behind center
      const cx = x + 0.5 - half;
      const cy = y + 0.5 - half;
      const radial = Math.hypot(cx, cy) / half;
      const glow = Math.pow(clamp01(1 - radial * 1.15), 2.2) * 0.28;
      r = lerp(r, 96, glow);
      g = lerp(g, 165, glow);
      b = lerp(b, 250, glow);

      // Thin orbital ring
      const ringDist = Math.abs(Math.hypot(cx, cy) - ringRadius);
      const ringThickness = Math.max(1.2, size * 0.011);
      const ringAlpha = clamp01(1 - (ringDist - ringThickness * 0.5)) * 0.24;
      r = lerp(r, 147, ringAlpha);
      g = lerp(g, 197, ringAlpha);
      b = lerp(b, 253, ringAlpha);

      // 4-point astroid star emblem: |x/R|^0.58 + |y/R|^0.58 <= 1
      const R = size * emblemScale;
      const ax = Math.abs(cx) / R;
      const ay = Math.abs(cy) / R;
      const starField = Math.pow(ax, 0.58) + Math.pow(ay, 0.58);
      // Smooth anti-aliased edge
      const aaStep = 1.8 / R;
      const starAlpha = clamp01((1 - starField) / aaStep + 0.5);

      if (starAlpha > 0) {
        const starT = clamp01((cx / R + cy / R + 2) / 4);
        const sr = lerp(255, 191, starT);
        const sg = lerp(255, 219, starT);
        const sb = lerp(255, 254, starT);
        r = lerp(r, sr, starAlpha);
        g = lerp(g, sg, starAlpha);
        b = lerp(b, sb, starAlpha);
      }

      // Secondary orbital satellite dot in top-right quadrant
      const satX = half + R * 0.62;
      const satY = half - R * 0.62;
      const satR = Math.max(2, size * (maskable ? 0.026 : 0.031));
      const satDist = Math.hypot(x + 0.5 - satX, y + 0.5 - satY) - satR;
      const satAlpha = clamp01(0.5 - satDist);
      if (satAlpha > 0) {
        r = lerp(r, 147, satAlpha);
        g = lerp(g, 197, satAlpha);
        b = lerp(b, 253, satAlpha);
      }

      rgba[idx] = Math.round(r);
      rgba[idx + 1] = Math.round(g);
      rgba[idx + 2] = Math.round(b);
      rgba[idx + 3] = Math.round(bgAlpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

const publicDir = path.resolve(process.cwd(), 'public');
fs.mkdirSync(publicDir, { recursive: true });

const targets = [
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'pwa-maskable-512x512.png', size: 512, maskable: true },
];

for (const t of targets) {
  const buf = renderNovaIcon(t.size, { maskable: t.maskable });
  fs.writeFileSync(path.join(publicDir, t.file), buf);
  console.log(`Generated public/${t.file} (${buf.length} bytes)`);
}
