// Small colour toolkit. Everything works on "#rrggbb" strings at the edges.

export function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 255, g: 77, b: 31 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const toHsl = (hex) => rgbToHsl(hexToRgb(hex));
export const fromHsl = (hsl) => rgbToHex(hslToRgb(hsl));

/** Rotate hue by `deg`, optionally nudging saturation / lightness. */
export function shift(hex, deg = 0, { s = 0, l = 0 } = {}) {
  const hsl = toHsl(hex);
  return fromHsl({
    h: hsl.h + deg,
    s: Math.max(0, Math.min(1, hsl.s + s)),
    l: Math.max(0, Math.min(1, hsl.l + l)),
  });
}

export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Readable text colour to sit on top of `hex`. */
export const onColor = (hex) => (luminance(hex) > 0.4 ? '#0c0c0d' : '#ffffff');

/**
 * Pull a vivid accent out of an image: bucket pixels by hue, weight by
 * saturation, then normalise the winner so it reads as a neon-ish accent.
 */
export function extractAccent(img) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = { r: data[i], g: data[i + 1], b: data[i + 2] };
    const { h, s, l } = rgbToHsl(rgb);
    if (l < 0.12 || l > 0.92 || s < 0.18) continue;
    const w = s * s * (1 - Math.abs(l - 0.55));
    const bin = bins[Math.floor(h / 15) % 24];
    bin.w += w; bin.r += rgb.r * w; bin.g += rgb.g * w; bin.b += rgb.b * w;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w === 0) return null;
  const hsl = rgbToHsl({ r: best.r / best.w, g: best.g / best.w, b: best.b / best.w });
  return fromHsl({ h: hsl.h, s: Math.max(0.72, hsl.s), l: Math.min(0.66, Math.max(0.56, hsl.l)) });
}
