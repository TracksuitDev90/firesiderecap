// Canvas renderer for a single recap card.
//
// Everything is drawn onto a <canvas> at a fixed 1080×1350 design size (times
// an export scale), so the live preview *is* the exported PNG — no DOM
// screenshotting quirks, identical output in every browser.

import { rgba, shift, mix, hexToRgb, onColor } from './color.js';
import { DISPLAY_FONTS } from './state.js';
import { isImageValue } from './assets.js';

export const CARD_W = 1080;
export const CARD_H = 1350;

// Ticket geometry (design px).
const T = { x: 48, y: 48, w: 984, h: 1254, r: 44 };
const PAD = 64;
const STUB_H = 214;
const NOTCH = 30;
const X0 = T.x + PAD;
const X1 = T.x + T.w - PAD;
const CW = X1 - X0;
const PERF_Y = T.y + T.h - STUB_H;
const MIN_NAME_TOP = T.y + 200;

const UI = "'Inter Tight', system-ui, sans-serif";
const SERIF = "'Instrument Serif', Georgia, serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const EMOJI_FONT = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

// ------------------------------------------------------------- helpers --

const hasLetterSpacing =
  typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function setFont(ctx, { family, weight = 400, size, style = 'normal', tracking = 0 }) {
  ctx.font = `${style} ${weight} ${size}px ${family}`;
  const px = tracking * size;
  if (hasLetterSpacing) ctx.letterSpacing = `${px}px`;
  ctx.__track = hasLetterSpacing ? 0 : px;
}

function textWidth(ctx, text) {
  const w = ctx.measureText(text).width;
  return ctx.__track ? w + ctx.__track * Array.from(text).length : w;
}

function drawText(ctx, text, x, y) {
  if (!ctx.__track) return ctx.fillText(text, x, y);
  // Manual letter-spacing for browsers without ctx.letterSpacing.
  const align = ctx.textAlign;
  const total = textWidth(ctx, text);
  let cx = align === 'center' ? x - total / 2 : align === 'right' || align === 'end' ? x - total : x;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + ctx.__track;
  }
  ctx.textAlign = align;
}

const capCache = new Map();
/** Cap-height as a fraction of font size, measured from the real font. */
function capRatio(ctx, family, weight = 400, style = 'normal') {
  const key = `${family}|${weight}|${style}`;
  if (!capCache.has(key)) {
    setFont(ctx, { family, weight, style, size: 100 });
    const m = ctx.measureText('H');
    const r = m.actualBoundingBoxAscent ? m.actualBoundingBoxAscent / 100 : 0.72;
    capCache.set(key, r);
  }
  return capCache.get(key);
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (!line || textWidth(ctx, test) <= maxW) line = test;
      else {
        out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Wrap, then narrow the measure as far as possible without adding lines, for an even rag. */
function balancedLines(ctx, text, maxW) {
  const base = wrapLines(ctx, text, maxW);
  if (base.length < 2) return base;
  let lo = maxW * 0.45, hi = maxW;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrapLines(ctx, text, mid).length <= base.length) hi = mid;
    else lo = mid;
  }
  return wrapLines(ctx, text, hi);
}

function smartQuotes(s) {
  return String(s)
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/'(\w)/g, '‘$1')
    .replace(/(\S)'/g, '$1’')
    .replace(/"(\S)/g, '“$1')
    .replace(/(\S)"/g, '$1”');
}

export function formatValue(v) {
  const s = String(v ?? '').trim();
  if (/^-?\d{4,}(\.\d+)?$/.test(s)) {
    const [i, d] = s.split('.');
    return Number(i).toLocaleString('en-US') + (d ? `.${d}` : '');
  }
  return s;
}

export function parseList(v) {
  return String(v || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^(.*?)[\s:–—-]*[([]?\s*(\d[\d,.]*)\s*[)\]]?$/);
      return m && m[1].trim() ? { name: m[1].trim(), count: m[2] } : { name: item, count: '' };
    });
}

const hasValue = (member, f) => String(member.values?.[f.id] ?? '').trim() !== '';

function squircle(ctx, x, y, w, h, n = 4.6) {
  const a = w / 2, b = h / 2, cx = x + a, cy = y + b;
  ctx.beginPath();
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const px = cx + a * Math.sign(c) * Math.abs(c) ** (2 / n);
    const py = cy + b * Math.sign(s) * Math.abs(s) ** (2 / n);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** The ticket silhouette: rounded top, side notches at the perforation, scalloped bottom. */
function ticketPath(ctx, begin = true) {
  const { x, y, w, h, r } = T;
  if (begin) ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, PERF_Y - NOTCH);
  ctx.arc(x + w, PERF_Y, NOTCH, -Math.PI / 2, Math.PI / 2, true);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  const span = w - 2 * r;
  const n = Math.floor(span / 24);
  const pitch = span / n;
  const sr = 6;
  for (let i = 0; i < n; i++) {
    const cx = x + w - r - pitch * (i + 0.5);
    ctx.lineTo(cx + sr, y + h);
    ctx.arc(cx, y + h, sr, 0, Math.PI, true);
  }
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, PERF_Y + NOTCH);
  ctx.arc(x, PERF_Y, NOTCH, Math.PI / 2, -Math.PI / 2, true);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// --------------------------------------------------------------- grain --

let noiseTile = null;
function getNoise() {
  if (noiseTile) return noiseTile;
  const size = 384;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    // Sum of randoms ≈ gaussian: softer, more film-like than flat noise.
    const v = ((Math.random() + Math.random() + Math.random()) / 3) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}

function drawGrain(ctx, amount) {
  if (amount <= 0) return;
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = ctx.createPattern(getNoise(), 'repeat');
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = clamp(amount, 0, 1) * 0.55;
  ctx.fillRect(0, 0, width, height);
  // Overlay barely touches near-black, so lift a few specks in the shadows too.
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = clamp(amount, 0, 1) * 0.085;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// ---------------------------------------------------------------- hero --

const heroCache = new Map();
const imageIds = new WeakMap();
let nextImageId = 1;
const imageId = (img) => {
  if (!img) return 0;
  if (!imageIds.has(img)) imageIds.set(img, nextImageId++);
  return imageIds.get(img);
};

function gradientLut(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  const cols = stops.map(([t, hex]) => [t, hexToRgb(hex)]);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < cols.length - 2 && t > cols[j + 1][0]) j++;
    const [t0, a] = cols[j];
    const [t1, b] = cols[j + 1];
    const u = clamp((t - t0) / (t1 - t0 || 1), 0, 1);
    lut[i * 3] = a.r + (b.r - a.r) * u;
    lut[i * 3 + 1] = a.g + (b.g - a.g) * u;
    lut[i * 3 + 2] = a.b + (b.b - a.b) * u;
  }
  return lut;
}

/** Cover-fit geometry for the avatar inside the hero box (design px). */
function coverGeometry(img, w, h, zoom, px, py) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * s, dh = ih * s;
  return { dw, dh, dx: (w - dw) * px, dy: (h - dh) * py };
}

function buildHero(img, w, h, k, opts) {
  const { style, accent, bg, zoom, px, py, fadeStart, seed } = opts;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.scale(k, k);

  if (img) {
    const g = coverGeometry(img, w, h, zoom, px, py);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, g.dx, g.dy, g.dw, g.dh);

    if (style !== 'natural') {
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const d = data.data;
      const lut =
        style === 'mono'
          ? gradientLut([[0, '#050506'], [0.55, '#6d6a66'], [1, '#e8e4dd']])
          : style === 'halftone'
            ? null
            : gradientLut([
                [0, '#040405'],
                [0.45, mix(accent, '#0a0a0b', 0.8)],
                [0.82, mix(accent, '#2a2a2c', 0.45)],
                [1, mix(accent, '#ffffff', 0.55)],
              ]);
      const lum = style === 'halftone' ? new Float32Array(c.width * c.height) : null;
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        let l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        l = clamp((l - 0.5) * 1.15 + 0.5, 0, 1) ** 1.25; // more contrast, darker mids
        if (lum) { lum[p] = l; continue; }
        const j = Math.round(l * 255) * 3;
        d[i] = lut[j]; d[i + 1] = lut[j + 1]; d[i + 2] = lut[j + 2];
      }
      if (lum) {
        // Halftone: dot radius follows luminance, on a 45° grid.
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        const step = 8;
        const dot = mix(accent, bg, 0.45);
        ctx.fillStyle = dot;
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(Math.PI / 4);
        const R = Math.hypot(w, h) / 2;
        for (let gy = -R; gy < R; gy += step) {
          for (let gx = -R; gx < R; gx += step) {
            const sx = (gx * Math.cos(Math.PI / 4) - gy * Math.sin(Math.PI / 4)) + w / 2;
            const sy = (gx * Math.sin(Math.PI / 4) + gy * Math.cos(Math.PI / 4)) + h / 2;
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            const l = lum[Math.floor(sy * k) * c.width + Math.floor(sx * k)];
            const r = step * 0.5 * l;
            if (r < 0.35) continue;
            ctx.beginPath();
            ctx.arc(gx, gy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      } else {
        ctx.putImageData(data, 0, 0);
      }
    } else {
      // Natural: keep colour, but mute it so type stays on top.
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = 'rgba(128,128,128,0.35)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(40,40,44,0.35)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  } else {
    // No avatar: a generative hypercolor field in the member's hues.
    const R = seeded(seed);
    ctx.fillStyle = mix(accent, '#000000', 0.7);
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'screen';
    const hues = [accent, shift(accent, -42), accent, shift(accent, 165, { s: -0.1 }), shift(accent, -85)];
    for (let i = 0; i < 6; i++) {
      const x = R() * w, y = R() * h * 0.9, r = (0.35 + R() * 0.45) * w;
      const col = hues[i % hues.length];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(col, 0.85));
      g.addColorStop(0.55, rgba(col, 0.25));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'multiply';
    const x = (0.3 + R() * 0.4) * w, y = (0.25 + R() * 0.3) * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, w * 0.4);
    g.addColorStop(0, 'rgba(0,0,0,0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Scrim under the header so it always reads.
  const scrim = ctx.createLinearGradient(0, 0, 0, 230);
  scrim.addColorStop(0, 'rgba(0,0,0,0.55)');
  scrim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, w, 230);

  // Fade out into the glass body.
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  const f = clamp(fadeStart, 0, 0.95);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(f, 'rgba(0,0,0,1)');
  fade.addColorStop(f + (1 - f) * 0.35, 'rgba(0,0,0,0.7)');
  fade.addColorStop(f + (1 - f) * 0.7, 'rgba(0,0,0,0.25)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

function getHero(img, w, h, k, opts) {
  const key = [imageId(img), Math.round(h), k, opts.style, opts.accent, opts.bg,
    opts.zoom.toFixed(3), opts.px.toFixed(3), opts.py.toFixed(3), opts.fadeStart.toFixed(3), opts.seed].join('|');
  if (!heroCache.has(key)) {
    if (heroCache.size > 12) heroCache.delete(heroCache.keys().next().value);
    heroCache.set(key, buildHero(img, w, h, k, opts));
  }
  return heroCache.get(key);
}

// -------------------------------------------------------------- layout --

function labelMetrics(ctx, s) {
  const size = 16.5 * s;
  return { size, cap: capRatio(ctx, UI, 600) * size, gap: 16 * s };
}

function drawLabel(ctx, text, x, top, st, s, align = 'left') {
  const m = labelMetrics(ctx, s);
  setFont(ctx, { family: UI, weight: 600, size: m.size, tracking: 0.16 });
  ctx.fillStyle = st.muted;
  ctx.textAlign = align;
  drawText(ctx, String(text).toUpperCase(), x, top + m.cap);
  ctx.textAlign = 'left';
  return top + m.cap + m.gap;
}

function numFont(font) {
  return { family: font.family, weight: font.weight, tracking: font.tracking + 0.005 };
}

/** Turn the field list into stacked, measured content blocks. */
function buildBlocks(ctx, project, member, s, font, stubEmoji, emojiImages) {
  const st = project.style;
  const lm = labelMetrics(ctx, s);
  const blocks = [];
  const visible = project.fields.filter((f) => f !== stubEmoji && hasValue(member, f));

  let i = 0;
  while (i < visible.length) {
    const f = visible[i];
    if (f.type === 'quote') {
      const size = 48 * s;
      let sz = size, lines;
      const text = smartQuotes(String(member.values[f.id]).trim());
      const quoted = /^[“"‘']/.test(text) ? text : `“${text}”`;
      for (;;) {
        setFont(ctx, { family: SERIF, style: 'italic', size: sz, tracking: -0.005 });
        lines = balancedLines(ctx, quoted, CW);
        if (lines.length <= 3 || sz < size * 0.62) break;
        sz *= 0.92;
      }
      const cap = capRatio(ctx, SERIF, 400, 'italic') * sz;
      const lh = sz * 1.04;
      const h = lm.cap + lm.gap + cap + (lines.length - 1) * lh;
      blocks.push({
        h,
        draw(y) {
          const top = drawLabel(ctx, f.label, X0, y, st, s);
          setFont(ctx, { family: SERIF, style: 'italic', size: sz, tracking: -0.005 });
          ctx.fillStyle = st.ink;
          lines.forEach((ln, n) => drawText(ctx, ln, X0 - sz * 0.02, top + cap + n * lh));
        },
      });
      i++;
    } else if (f.type === 'list') {
      const items = parseList(member.values[f.id]);
      const nameSize = 35 * s, countSize = 18 * s, gapX = 38 * s;
      setFont(ctx, { family: UI, weight: 600, size: nameSize, tracking: -0.015 });
      const rows = [[]];
      let x = 0;
      for (const it of items) {
        setFont(ctx, { family: UI, weight: 600, size: nameSize, tracking: -0.015 });
        const nw = textWidth(ctx, it.name);
        setFont(ctx, { family: MONO, weight: 500, size: countSize });
        const cw = it.count ? textWidth(ctx, it.count) + 7 * s : 0;
        const w = nw + cw;
        if (x > 0 && x + w > CW) { rows.push([]); x = 0; }
        rows[rows.length - 1].push({ ...it, x, nw });
        x += w + gapX;
      }
      const cap = capRatio(ctx, UI, 600) * nameSize;
      const lh = nameSize * 1.35;
      const h = lm.cap + lm.gap + cap + (rows.length - 1) * lh;
      blocks.push({
        h,
        draw(y) {
          const top = drawLabel(ctx, f.label, X0, y, st, s);
          rows.forEach((row, r) => {
            const base = top + cap + r * lh;
            for (const it of row) {
              setFont(ctx, { family: UI, weight: 600, size: nameSize, tracking: -0.015 });
              ctx.fillStyle = st.ink;
              drawText(ctx, it.name, X0 + it.x, base);
              if (it.count) {
                setFont(ctx, { family: MONO, weight: 500, size: countSize });
                ctx.fillStyle = member.accent;
                drawText(ctx, formatValue(it.count), X0 + it.x + it.nw + 7 * s, base - cap + countSize * 0.72);
              }
            }
          });
        },
      });
      i++;
    } else {
      // A run of consecutive stat-like fields becomes a grid.
      const run = [];
      while (i < visible.length && (visible[i].type === 'stat' || visible[i].type === 'emoji')) run.push(visible[i++]);
      const rows = [];
      let pending = [];
      const flush = () => {
        if (!pending.length) return;
        const n = Math.ceil(pending.length / 3);
        const per = Math.ceil(pending.length / n);
        for (let j = 0; j < pending.length; j += per) rows.push(pending.slice(j, j + per));
        pending = [];
      };
      for (const f2 of run) {
        if (f2.wide) { flush(); rows.push([f2]); } else pending.push(f2);
      }
      flush();

      const gapX = 32 * s, gapY = 34 * s;
      const nf = numFont(font);
      const measured = rows.map((row) => {
        const cols = row.length;
        const cellW = (CW - gapX * (cols - 1)) / cols;
        const base = (cols === 1 ? (row[0].wide ? 132 : 98) : cols === 2 ? 98 : 78) * s;
        let size = base;
        for (const f2 of row) {
          if (f2.type === 'emoji') continue;
          setFont(ctx, { ...nf, size: base });
          const w = textWidth(ctx, formatValue(member.values[f2.id]));
          size = Math.min(size, base * (cellW / Math.max(w, 1)));
        }
        const cap = capRatio(ctx, nf.family, nf.weight) * size;
        return { row, cellW, size, cap, h: lm.cap + lm.gap + cap };
      });
      const h = measured.reduce((a, r) => a + r.h, 0) + gapY * (measured.length - 1);
      blocks.push({
        h,
        draw(y) {
          let top = y;
          for (const r of measured) {
            r.row.forEach((f2, c) => {
              const x = X0 + c * (r.cellW + gapX);
              const vt = drawLabel(ctx, f2.label, x, top, st, s);
              const v = String(member.values[f2.id]).trim();
              if (f2.type === 'emoji') {
                const img = emojiImages?.get(f2.id);
                const e = r.cap * 1.3;
                if (img) ctx.drawImage(img, x, vt + r.cap - e * 0.9, e, e);
                else if (!isImageValue(v)) {
                  ctx.font = `${e}px ${EMOJI_FONT}`;
                  ctx.fillText(v, x, vt + r.cap);
                }
                return;
              }
              setFont(ctx, { ...nf, size: r.size });
              ctx.fillStyle = member.accent;
              drawText(ctx, formatValue(v), x - r.size * 0.03, vt + r.cap);
            });
            top += r.h + gapY;
          }
        },
      });
    }
  }
  return blocks;
}

export function layoutCard(ctx, project, member, emojiImages = null) {
  const font = DISPLAY_FONTS[project.style.displayFont] || DISPLAY_FONTS.unbounded;
  const stubEmoji = project.fields.find((f) => f.type === 'emoji' && hasValue(member, f)) || null;
  const name = String(member.name || '').trim() || ' ';
  let s = 1;
  let result;
  for (let attempt = 0; attempt < 10; attempt++) {
    const blocks = buildBlocks(ctx, project, member, s, font, stubEmoji, emojiImages);
    const gap = 42 * s;
    const contentH = blocks.reduce((a, b) => a + b.h, 0) + gap * Math.max(0, blocks.length - 1);
    const contentBottom = PERF_Y - 56;
    const contentTop = contentBottom - contentH;

    const base = 156 * clamp(s, 0.78, 1);
    let nameSize = base;
    let nameLines = [name];
    setFont(ctx, { family: font.family, weight: font.weight, size: base, tracking: font.tracking });
    const nw = textWidth(ctx, name);
    if (nw > CW) {
      nameSize = base * (CW / nw);
      // Long multi-word names: two balanced lines beat one tiny line.
      const words = name.split(/\s+/);
      if (nameSize < base * 0.62 && words.length > 1) {
        let best = null;
        for (let k = 1; k < words.length; k++) {
          const ls = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
          const w = Math.max(...ls.map((l) => textWidth(ctx, l)));
          if (!best || w < best.w) best = { ls, w };
        }
        const two = Math.min(base * 0.86, base * (CW / best.w));
        if (two > nameSize * 1.15) {
          nameSize = two;
          nameLines = best.ls;
        }
      }
    }
    const nameCap = capRatio(ctx, font.family, font.weight) * nameSize;
    const nameLH = nameSize * 0.98;
    const nameGap = blocks.length ? 0.16 * nameSize + 26 * s : 0;
    const nameBaseline = contentTop - nameGap;
    const nameTop = nameBaseline - nameCap - (nameLines.length - 1) * nameLH;

    result = { font, blocks, gap, contentTop, nameSize, nameCap, nameLines, nameLH, nameBaseline, stubEmoji, s };
    if (nameTop >= MIN_NAME_TOP || s < 0.6) break;
    s *= 0.94;
  }
  const heroBottom = result.nameBaseline + result.nameSize * 0.3 + 40;
  result.heroH = clamp(heroBottom - T.y, 420, PERF_Y - T.y);
  return result;
}

// ------------------------------------------------------------- drawing --

function drawBackground(ctx, st, accent, R) {
  ctx.fillStyle = st.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const g = clamp(st.glow, 0, 1);
  if (g <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const blobs = [
    { x: CARD_W * (0.72 + R() * 0.3), y: CARD_H * (0.02 + R() * 0.18), r: 640, c: accent, a: 0.6 },
    { x: CARD_W * (-0.08 + R() * 0.22), y: CARD_H * (0.5 + R() * 0.25), r: 720, c: shift(accent, 150 + R() * 40, { s: -0.1 }), a: 0.32 },
    { x: CARD_W * (0.45 + R() * 0.4), y: CARD_H * (0.92 + R() * 0.1), r: 600, c: shift(accent, -(45 + R() * 25)), a: 0.55 },
  ];
  for (const b of blobs) {
    const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    rg.addColorStop(0, rgba(b.c, b.a * g));
    rg.addColorStop(0.45, rgba(b.c, b.a * g * 0.38));
    rg.addColorStop(1, rgba(b.c, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  ctx.restore();
}

function drawTicketBody(ctx, st, k) {
  // Drop shadow, drawn only outside the ticket so the glass stays clear.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CARD_W, CARD_H);
  ticketPath(ctx, false);
  ctx.clip('evenodd');
  ticketPath(ctx);
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 70 * k;
  ctx.shadowOffsetY = 26 * k;
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ticketPath(ctx);
  ctx.fillStyle = rgba(st.ticket, 1 - clamp(st.glass, 0, 1) * 0.5);
  ctx.fill();
  ctx.restore();
}

function drawHeader(ctx, project, member, index, font) {
  const { event: ev, style: st } = project;
  const top = T.y + 58;
  ctx.textBaseline = 'alphabetic';

  const tSize = 28;
  setFont(ctx, { family: font.family, weight: font.weight, size: tSize, tracking: font.tracking + 0.02 });
  ctx.fillStyle = st.ink;
  ctx.textAlign = 'left';
  const tCap = capRatio(ctx, font.family, font.weight) * tSize;
  drawText(ctx, String(ev.title || '').toUpperCase(), X0, top + tCap);

  setFont(ctx, { family: SERIF, style: 'italic', size: 34 });
  ctx.fillStyle = rgba(st.ink, 0.78);
  drawText(ctx, [ev.subtitle, ev.year].filter(Boolean).join(' '), X0, top + tCap + 38);

  ctx.textAlign = 'right';
  setFont(ctx, { family: UI, weight: 600, size: 15, tracking: 0.2 });
  ctx.fillStyle = rgba(st.ink, 0.66);
  drawText(ctx, String(ev.admit || '').toUpperCase(), X1, top + 11);
  setFont(ctx, { family: MONO, weight: 500, size: 24, tracking: 0.02 });
  ctx.fillStyle = st.ink;
  drawText(ctx, `NO. ${String(index + 1).padStart(3, '0')}`, X1, top + tCap + 38);
  ctx.textAlign = 'left';
}

function drawName(ctx, member, L, st, k) {
  const { font, nameSize, nameBaseline, nameLines, nameLH } = L;
  if (!String(member.name || '').trim()) return;
  nameLines.forEach((line, i) => {
    drawNameLine(ctx, line, nameBaseline - (nameLines.length - 1 - i) * nameLH, member, font, nameSize, st, k);
  });
}

function drawNameLine(ctx, text, nameBaseline, member, font, nameSize, st, k) {
  const accent = member.accent;
  setFont(ctx, { family: font.family, weight: font.weight, size: nameSize, tracking: font.tracking });
  ctx.textAlign = 'left';
  const x = X0 - nameSize * 0.04;
  const a = clamp(st.aura, 0, 1);
  if (a > 0) {
    // Chromatic "aura": two blurred, hue-shifted ghosts offset in opposite
    // directions behind the crisp word. Shadows are cast from far off-canvas
    // so only the blur lands on the card.
    const off = 20000;
    const layers = [
      { c: shift(accent, 48, { l: 0.08, s: 0.1 }), dx: -9, dy: -4, blur: 30, alpha: 0.95 },
      { c: shift(accent, -62, { s: 0.1 }), dx: 9, dy: 5, blur: 30, alpha: 0.9 },
    ];
    for (const ly of layers) {
      ctx.save();
      ctx.shadowColor = rgba(ly.c, ly.alpha * Math.min(1, a * 1.6));
      ctx.shadowBlur = ly.blur * a * k;
      ctx.shadowOffsetX = (off + ly.dx * a) * k;
      ctx.shadowOffsetY = ly.dy * a * k;
      ctx.fillStyle = '#000';
      drawText(ctx, text, x - off, nameBaseline);
      ctx.restore();
    }
  }
  ctx.fillStyle = accent;
  drawText(ctx, text, x, nameBaseline);
}

function drawTile(ctx, x, y, size, accent, R, emojiImg, emojiText, fallback, k) {
  ctx.save();
  squircle(ctx, x, y, size, size);
  ctx.shadowColor = rgba(accent, 0.55);
  ctx.shadowBlur = 50 * k;
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.restore();

  ctx.save();
  squircle(ctx, x, y, size, size);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, size, size);
  const hues = [shift(accent, 50, { s: 0.1 }), shift(accent, -60, { s: 0.1 }), shift(accent, 170, { s: 0.05 }), mix(accent, '#ffffff', 0.35)];
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i++) {
    const cx = x + R() * size, cy = y + R() * size, r = size * (i === 3 ? 0.3 : 0.45 + R() * 0.4);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(hues[i], i === 3 ? 0.7 : 0.85));
    g.addColorStop(1, rgba(hues[i], 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, size, size);
  }
  // Dark core, like the glass app-icon references.
  ctx.globalCompositeOperation = 'multiply';
  const cx = x + size * (0.35 + R() * 0.3), cy = y + size * (0.3 + R() * 0.3);
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.55);
  core.addColorStop(0, 'rgba(10,6,20,0.85)');
  core.addColorStop(1, 'rgba(10,6,20,0)');
  ctx.fillStyle = core;
  ctx.fillRect(x, y, size, size);
  ctx.globalCompositeOperation = 'source-over';
  // Rim light.
  squircle(ctx, x, y, size, size);
  const rim = ctx.createLinearGradient(x, y, x + size, y + size);
  rim.addColorStop(0, 'rgba(255,255,255,0.85)');
  rim.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  rim.addColorStop(1, 'rgba(255,255,255,0.45)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 5;
  ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = 10 * k;
  ctx.stroke();
  ctx.restore();

  const e = size * 0.58;
  const ex = x + (size - e) / 2, ey = y + (size - e) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 16 * k;
  ctx.shadowOffsetY = 6 * k;
  if (emojiImg) {
    ctx.drawImage(emojiImg, ex, ey, e, e);
  } else if (emojiText) {
    ctx.font = `${e * 0.9}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emojiText, x + size / 2, y + size / 2 + e * 0.04);
  } else if (fallback) {
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    setFont(ctx, { family: SERIF, style: 'italic', size: size * 0.46 });
    ctx.fillStyle = onColor(accent);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawText(ctx, fallback, x + size / 2, y + size / 2);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawStub(ctx, project, member, index, L, assets, R, k) {
  const { event: ev, style: st } = project;
  const bottom = T.y + T.h;

  // Perforation.
  ctx.save();
  ctx.setLineDash([0.1, 13]);
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = rgba(st.ink, 0.2);
  ctx.beginPath();
  ctx.moveTo(T.x + NOTCH + 18, PERF_Y);
  ctx.lineTo(T.x + T.w - NOTCH - 18, PERF_Y);
  ctx.stroke();
  ctx.restore();

  const size = 134;
  const tx = X0;
  const ty = Math.round((PERF_Y + bottom) / 2 - size / 2 - 3);
  const raw = L.stubEmoji ? String(member.values[L.stubEmoji.id]).trim() : '';
  const emojiVal = isImageValue(raw) ? '' : raw;
  const yearTag = ev.year ? `’${String(ev.year).slice(-2)}` : '♥';
  drawTile(ctx, tx, ty, size, member.accent, R, assets.stubEmoji, assets.stubEmoji ? '' : emojiVal, yearTag, k);

  // Label + fine print, vertically centred on the tile.
  const textX = tx + size + 40;
  const maxW = X1 - 40 - textX;
  const lm = labelMetrics(ctx, 1);
  const fp = String(ev.finePrint || '').replace(/\{name\}/gi, String(member.name || '').trim());
  setFont(ctx, { family: UI, weight: 400, size: 19, tracking: 0 });
  let lines = wrapLines(ctx, fp, maxW);
  if (lines.length > 4) {
    lines = lines.slice(0, 4);
    lines[3] = lines[3].replace(/\s*\S*$/, '…');
  }
  const lh = 28;
  const fpCap = capRatio(ctx, UI, 400) * 19;
  const label = L.stubEmoji ? L.stubEmoji.label : '';
  const blockH = (label ? lm.cap + lm.gap + 4 : 0) + fpCap + (lines.length - 1) * lh;
  let y = ty + size / 2 - blockH / 2;
  if (label) y = drawLabel(ctx, label, textX, y, st, 1) + 4;
  setFont(ctx, { family: UI, weight: 400, size: 19, tracking: 0 });
  ctx.fillStyle = rgba(st.ink, 0.62);
  lines.forEach((ln, n) => drawText(ctx, ln, textX, y + fpCap + n * lh));

  // Serial number, running up the right edge of the stub.
  const code = hash(`${member.id}${member.name}`).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  const serial = `${ev.serialPrefix || ''}${String(ev.year || '').slice(-2)}-${String(index + 1).padStart(3, '0')}-${code}`;
  ctx.save();
  ctx.translate(T.x + T.w - 40, (PERF_Y + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  setFont(ctx, { family: MONO, weight: 500, size: 13, tracking: 0.16 });
  ctx.fillStyle = rgba(st.ink, 0.38);
  ctx.textAlign = 'center';
  drawText(ctx, serial, 0, 5);
  ctx.restore();
  ctx.textAlign = 'left';
}

/**
 * Draw one member's card. `assets` = { avatar, stubEmoji, emoji: Map<fieldId, img> }.
 * Returns geometry the editor uses for drag-to-reposition.
 */
export function drawCard(canvas, { project, member, index = 0, assets = {}, scale = 1 }) {
  const k = scale;
  if (canvas.width !== CARD_W * k) canvas.width = CARD_W * k;
  if (canvas.height !== CARD_H * k) canvas.height = CARD_H * k;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.textBaseline = 'alphabetic';

  const st = project.style;
  const accent = member.accent;
  const seed = hash(member.id || member.name || 'x');
  const R = seeded(seed);

  const L = layoutCard(ctx, project, member, assets.emoji);

  drawBackground(ctx, st, accent, R);
  drawTicketBody(ctx, st, k);

  ctx.save();
  ticketPath(ctx);
  ctx.clip();

  // Hero image (or generative field), faded into the glass.
  const heroOpts = {
    style: st.imageStyle,
    accent,
    bg: st.ticket,
    zoom: Number(member.avatarZoom) || 1,
    px: clamp(Number(member.avatarX ?? 0.5), 0, 1),
    py: clamp(Number(member.avatarY ?? 0.4), 0, 1),
    fadeStart: 0.4,
    seed,
  };
  const hero = getHero(assets.avatar, T.w, L.heroH, k, heroOpts);
  ctx.globalAlpha = clamp(st.imageStrength, 0, 1);
  ctx.drawImage(hero, T.x, T.y, T.w, L.heroH);
  ctx.globalAlpha = 1;

  // Soft sheen across the glass.
  const sheen = ctx.createLinearGradient(T.x, T.y, T.x + T.w * 0.6, T.y + T.h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(T.x, T.y, T.w, T.h);
  ctx.restore();

  // Texture pass (image + background get the full grain).
  drawGrain(ctx, st.grain);

  ctx.save();
  ticketPath(ctx);
  ctx.clip();
  drawHeader(ctx, project, member, index, L.font);
  drawName(ctx, member, L, st, k);
  let y = L.contentTop;
  for (const b of L.blocks) {
    b.draw(y);
    y += b.h + L.gap;
  }
  drawStub(ctx, project, member, index, L, assets, seeded(seed ^ 0x9e3779b9), k);
  ctx.restore();

  // Glass edge.
  ctx.save();
  ticketPath(ctx);
  const edge = ctx.createLinearGradient(0, T.y, 0, T.y + T.h);
  edge.addColorStop(0, 'rgba(255,255,255,0.22)');
  edge.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  edge.addColorStop(1, 'rgba(255,255,255,0.12)');
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // A lighter grain over the type keeps it cohesive without hurting legibility.
  drawGrain(ctx, st.grain * 0.3);

  const geo = assets.avatar
    ? coverGeometry(assets.avatar, T.w, L.heroH, heroOpts.zoom, heroOpts.px, heroOpts.py)
    : null;
  return { hero: { x: T.x, y: T.y, w: T.w, h: L.heroH, geo } };
}
