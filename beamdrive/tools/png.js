/* Minimal PNG encoder (RGBA, no filtering) so the build can generate the
   app icons without any image dependencies. */
'use strict';
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array of w*h*4 */
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;   // filter: none
    rgba.copy
      ? Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
      : Buffer.from(rgba.slice(y * w * 4, (y + 1) * w * 4)).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* The app icon: a dark rounded tile with an orange chevron/speed mark. */
function makeIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const R = size * 0.22;                       // corner radius
  function inRounded(x, y) {
    const cx = Math.min(Math.max(x, R), size - R);
    const cy = Math.min(Math.max(y, R), size - R);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= R * R;
  }
  function set(i, r, g, b, a) {
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x + 0.5, y + 0.5)) { set(i, 0, 0, 0, 0); continue; }
      // Background gradient.
      const t = y / size;
      let r = Math.round(18 + t * 6), g = Math.round(20 + t * 6), b = Math.round(27 + t * 7);

      const u = (x / size - 0.5), v = (y / size - 0.5);

      // Three slanted speed bars.
      const slant = u + v * 0.42;
      for (let k = 0; k < 3; k++) {
        const c = -0.20 + k * 0.19;
        const wBar = 0.055 - k * 0.006;
        if (Math.abs(slant - c) < wBar && Math.abs(v) < 0.30 - k * 0.03) {
          const glow = 1 - Math.abs(slant - c) / wBar;
          const inten = 0.55 + glow * 0.45;
          r = Math.round(255 * inten);
          g = Math.round((122 + k * 26) * inten);
          b = Math.round((26 + k * 20) * inten);
        }
      }
      // A subtle wheel arc bottom-right.
      const dr = Math.hypot(u - 0.22, v - 0.24);
      if (dr > 0.155 && dr < 0.185) {
        r = Math.round(r * 0.4 + 200 * 0.6);
        g = Math.round(g * 0.4 + 205 * 0.6);
        b = Math.round(b * 0.4 + 215 * 0.6);
      }
      set(i, r, g, b, 255);
    }
  }
  return encodePNG(size, size, px);
}

module.exports = { encodePNG, makeIcon };
