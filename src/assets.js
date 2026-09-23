// Image + emoji loading with caching. The renderer is synchronous, so callers
// `await prepareAssets(...)` first and then hand the resolved images over.

const imageCache = new Map();

export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (!imageCache.has(src)) {
    const p = new Promise((resolve) => {
      const img = new Image();
      if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, p);
    // Don't keep failures around forever, so a retry can succeed.
    p.then((img) => { if (!img) imageCache.delete(src); });
  }
  return imageCache.get(src);
}

/** Read an uploaded File into a downscaled data URL (keeps the saved project small). */
export async function fileToDataUrl(file, maxSize = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (!img) throw new Error('Could not read that image.');
    return imageToDataUrl(img, maxSize, file.type === 'image/png' || file.type === 'image/gif');
  } finally {
    imageCache.delete(url);
    URL.revokeObjectURL(url);
  }
}

export function imageToDataUrl(img, maxSize = 1024, keepAlpha = false) {
  const s = Math.min(1, maxSize / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return keepAlpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
}

/** Fetch a remote image (e.g. a Discord avatar URL) and inline it as a data URL. */
export async function urlToDataUrl(url, maxSize = 1024) {
  const img = await loadImage(url);
  if (!img) throw new Error("Couldn't load that URL. Try downloading the image and uploading it instead.");
  try {
    return imageToDataUrl(img, maxSize, /\.png|\.gif|\.webp/i.test(url));
  } catch {
    throw new Error("That site doesn't allow its images to be reused. Download the image and upload it instead.");
  }
}

// ---------------------------------------------------------------- emoji --

// Twemoji is the emoji set Discord uses, so cards match what people see in the server.
export const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/npm/@twemoji/svg@15.0.0/';

export function firstGrapheme(str) {
  const s = String(str || '').trim();
  if (!s) return '';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator]();
    return it.next().value?.segment || '';
  }
  return Array.from(s)[0];
}

export function twemojiCode(emoji) {
  const raw = emoji.includes('‍') ? emoji : emoji.replace(/️/g, '');
  return Array.from(raw).map((ch) => ch.codePointAt(0).toString(16)).join('-');
}

export const isImageValue = (v) => /^(data:image\/|https?:\/\/|blob:)/i.test(String(v || '').trim());

const emojiCache = new Map();

/**
 * Resolve an emoji field value to an image. Custom (image/URL) values load
 * directly; unicode emoji load from Twemoji. Returns null when unavailable,
 * in which case the renderer falls back to the system emoji font.
 */
export function loadEmoji(value) {
  const v = String(value || '').trim();
  if (!v) return Promise.resolve(null);
  if (isImageValue(v)) return loadImage(v);
  const g = firstGrapheme(v);
  if (!g || /^[\p{L}\p{N}\p{P}\s]+$/u.test(g)) return Promise.resolve(null);
  const code = twemojiCode(g);
  if (!emojiCache.has(code)) {
    const p = fetch(`${TWEMOJI_BASE}${code}.svg`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
      .then((svg) => {
        // Give the SVG an explicit size so every browser rasterises it crisply.
        const sized = svg.replace('<svg ', '<svg width="512" height="512" ');
        return loadImage(URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' })));
      })
      .catch(() => null);
    emojiCache.set(code, p);
  }
  return emojiCache.get(code);
}
