/**
 * Generates the PWA icon set as real PNG files with zero dependencies.
 *
 * Run with: node scripts/generate-icons.mjs
 *
 * The previous icons checked into public/icons were 1x1 placeholders, which made
 * Chrome reject the manifest ("resource isn't a valid image") and blocked PWA
 * installation. This script rasterizes a SteamGuard shield logo instead.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = resolve(HERE, '../public/icons');

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encodes an RGBA pixel buffer (width*height*4) as an 8-bit RGBA PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ------------------------------------------------------------------ Rasterizer

/** Even-odd point-in-polygon test using normalized (0..1) coordinates. */
function inPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Signed distance to a rounded rectangle, used for the badge background. */
function roundedRectDistance(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Shield outline as a closed polygon, drawn in a 0..1 box.
 * Wide shoulders at the top tapering to a point at the bottom.
 */
const SHIELD_OUTER = [
  [0.5, 0.08],
  [0.845, 0.2],
  [0.845, 0.46],
  [0.79, 0.66],
  [0.5, 0.92],
  [0.21, 0.66],
  [0.155, 0.46],
  [0.155, 0.2]
];

/** Inner cut-out that turns the shield into a thick outline. */
const SHIELD_INNER = [
  [0.5, 0.19],
  [0.755, 0.277],
  [0.755, 0.445],
  [0.712, 0.598],
  [0.5, 0.788],
  [0.288, 0.598],
  [0.245, 0.445],
  [0.245, 0.277]
];

/** Check mark inside the shield. */
const CHECK = [
  [0.355, 0.5],
  [0.428, 0.428],
  [0.482, 0.482],
  [0.596, 0.376],
  [0.668, 0.45],
  [0.482, 0.63]
];

const CYAN = [0x00, 0xd2, 0xff];
const WHITE = [0xff, 0xff, 0xff];
const BLACK = [0x00, 0x00, 0x00];
const NAVY = [0x07, 0x07, 0x0a];

function blend(dst, offset, color, alpha) {
  if (alpha <= 0) return;
  const inv = 1 - alpha;
  dst[offset] = Math.round(color[0] * alpha + dst[offset] * inv);
  dst[offset + 1] = Math.round(color[1] * alpha + dst[offset + 1] * inv);
  dst[offset + 2] = Math.round(color[2] * alpha + dst[offset + 2] * inv);
  dst[offset + 3] = Math.max(dst[offset + 3], Math.round(255 * alpha));
}

/**
 * Renders the icon.
 * @param {number} size    output edge length in pixels
 * @param {object} options
 * @param {boolean} options.maskable  full-bleed background, logo inside the 80% safe zone
 * @param {boolean} options.transparent  omit the background plate entirely
 */
function renderIcon(size, { maskable = false, transparent = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const SS = 3; // supersampling factor per axis for anti-aliasing

  // Background geometry. Maskable icons fill the whole canvas so Android can crop
  // them to any shape without clipping the logo.
  const bgRadius = maskable ? 0 : 0.22;
  const plateHalf = 0.5;
  const logoScale = maskable ? 0.62 : 0.8;
  const logoCx = 0.5;
  const logoCy = 0.5;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let shieldHits = 0;
      let checkHits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;

          if (!transparent && roundedRectDistance(x, y, 0.5, 0.5, plateHalf, plateHalf, bgRadius) <= 0) {
            bgHits++;
          }

          // Map into the logo's local 0..1 space, centered and scaled.
          const lx = (x - logoCx) / logoScale + 0.5;
          const ly = (y - logoCy) / logoScale + 0.5;

          if (lx >= 0 && lx <= 1 && ly >= 0 && ly <= 1) {
            const inOuter = inPolygon(SHIELD_OUTER, lx, ly);
            const inInner = inPolygon(SHIELD_INNER, lx, ly);
            if (inOuter && !inInner) shieldHits++;
            if (inPolygon(CHECK, lx, ly)) checkHits++;
          }
        }
      }

      const total = SS * SS;
      const offset = (py * size + px) * 4;

      if (bgHits > 0) {
        const t = bgHits / total;
        const color = maskable ? NAVY : BLACK;
        blend(rgba, offset, color, t);
      }

      if (checkHits > 0) blend(rgba, offset, WHITE, checkHits / total);
      else if (shieldHits > 0) blend(rgba, offset, CYAN, shieldHits / total);
    }
  }

  return encodePng(size, size, rgba);
}

// ----------------------------------------------------------------------- Main

mkdirSync(ICON_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, options: {} },
  { file: 'icon-512.png', size: 512, options: {} },
  // Maskable variant: Android crops this one, so it needs a full-bleed plate.
  { file: 'icon-maskable-512.png', size: 512, options: { maskable: true } },
  // iOS home-screen icon. Apple ignores transparency, so keep the plate.
  { file: 'apple-touch-icon.png', size: 180, options: {} },
  // Favicon variant with a transparent plate so it reads well on light backgrounds.
  { file: 'favicon-64.png', size: 64, options: { transparent: true } }
];

for (const { file, size, options } of targets) {
  const png = renderIcon(size, options);
  writeFileSync(resolve(ICON_DIR, file), png);
  console.log(`${file.padEnd(24)} ${size}x${size}  ${png.length} bytes`);
}