import { drawCard, CARD_W, CARD_H } from './render.js';
import {
  FIELD_TYPES, ACCENTS, DISPLAY_FONTS, IMAGE_STYLES,
  defaultProject, normalizeProject, blankMember, nextAccent, uid, slug,
} from './state.js';
import { loadImage, loadEmoji, fileToDataUrl, urlToDataUrl, isImageValue } from './assets.js';
import { extractAccent, onColor } from './color.js';
import { parseCsv, toCsv } from './csv.js';
import { makeZip } from './zip.js';
import * as storage from './storage.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const FONT_SPECS = [
  "800 40px 'Unbounded'", "400 40px 'Archivo Black'", "800 40px 'Bricolage Grotesque'", "800 40px 'Syne'",
  "400 40px 'Inter Tight'", "500 40px 'Inter Tight'", "600 40px 'Inter Tight'", "700 40px 'Inter Tight'",
  "800 40px 'Inter Tight'", "400 40px 'Instrument Serif'", "italic 400 40px 'Instrument Serif'",
  "500 40px 'JetBrains Mono'",
];

const state = {
  project: null,
  tab: 'member',
  search: '',
  geometry: null,
  renderToken: 0,
};

const P = () => state.project;
const active = () => P().members.find((m) => m.id === P().activeId) || P().members[0];
const activeIndex = () => P().members.indexOf(active());

// ------------------------------------------------------------ fonts --

async function ensureFonts(text = '') {
  const sample = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ${text}`;
  await Promise.all(FONT_SPECS.map((f) => document.fonts.load(f, sample).catch(() => {})));
}

function cardText(member) {
  const p = P();
  return [member.name, p.event.title, p.event.subtitle, p.event.finePrint, p.event.admit,
    ...p.fields.map((f) => `${f.label} ${member.values[f.id] ?? ''}`)].join(' ');
}

// ----------------------------------------------------------- render --

async function prepareAssets(project, member) {
  const avatar = member.avatar ? await loadImage(member.avatar) : null;
  const emojiFields = project.fields.filter((f) => f.type === 'emoji' && String(member.values[f.id] ?? '').trim());
  const imgs = await Promise.all(emojiFields.map((f) => loadEmoji(member.values[f.id])));
  return {
    avatar,
    stubEmoji: emojiFields.length ? imgs[0] : null,
    emoji: new Map(emojiFields.map((f, i) => [f.id, imgs[i]])),
  };
}

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(async () => {
    rafPending = false;
    const token = ++state.renderToken;
    const member = active();
    const [assets] = await Promise.all([prepareAssets(P(), member), ensureFonts(cardText(member))]);
    if (token !== state.renderToken) return;
    state.geometry = drawCard($('#card'), { project: P(), member, index: activeIndex(), assets, scale: 1 });
    $('#card').classList.toggle('can-drag', !!state.geometry.hero.geo);
  });
}

async function renderToBlob(member, index, scale) {
  const [assets] = await Promise.all([prepareAssets(P(), member), ensureFonts(cardText(member))]);
  const c = document.createElement('canvas');
  drawCard(c, { project: P(), member, index, assets, scale });
  const jpeg = P().style.exportFormat === 'jpeg';
  return new Promise((resolve) => c.toBlob(resolve, jpeg ? 'image/jpeg' : 'image/png', 0.93));
}

const fileName = (member, index) =>
  `${slug(P().event.title)}-recap-${slug(P().event.year)}-${String(index + 1).padStart(2, '0')}-${slug(member.name)}` +
  (P().style.exportFormat === 'jpeg' ? '.jpg' : '.png');

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ------------------------------------------------------------ saving --

let saveTimer = 0;
function persist() {
  $('#save-state').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ok = await storage.save('project', P());
    $('#save-state').textContent = ok ? 'Saved' : 'Not saved';
  }, 450);
}

/** Call after any change; the flags say which panels need rebuilding. */
function changed({ members = false, inspector = false } = {}) {
  if (members) renderMembers();
  if (inspector) renderInspector();
  applyAccent();
  scheduleRender();
  persist();
}

// ------------------------------------------------------------- toast --

let toastTimer = 0;
function toast(msg, { error = false, sticky = false, progress = null } = {}) {
  const el = $('#toast');
  el.className = `toast show${error ? ' error' : ''}`;
  el.innerHTML = `${esc(msg)}${progress !== null ? `<div class="progress"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ''}`;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => el.classList.remove('show'), error ? 6000 : 3200);
}

// ------------------------------------------------------ member list --

function applyAccent() {
  const accent = active().accent;
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--on-accent', onColor(accent));
}

function filledCount(m) {
  return P().fields.filter((f) => String(m.values[f.id] ?? '').trim()).length;
}

function renderMembers() {
  const list = $('#member-list');
  const q = state.search.trim().toLowerCase();
  const members = P().members;
  $('#member-count').textContent = members.length;
  const total = P().fields.length;
  const items = members
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !q || String(m.name).toLowerCase().includes(q));
  list.innerHTML = items.length
    ? items
        .map(({ m, i }) => {
          const n = filledCount(m);
          const initial = esc(Array.from(String(m.name || '?').trim())[0] || '?').toUpperCase();
          return `<li class="member-item" role="option" data-action="select-member" data-id="${m.id}"
              aria-selected="${m.id === P().activeId}" style="--m-accent:${esc(m.accent)};--m-on:${onColor(m.accent)}">
            ${m.avatar ? `<img class="avatar" src="${esc(m.avatar)}" alt="">` : `<span class="avatar">${initial}</span>`}
            <span class="member-meta"><strong>${esc(m.name || 'Untitled')}</strong><span>No. ${String(i + 1).padStart(3, '0')}</span></span>
            <span class="fill${n === total ? ' done' : ''}" title="${n} of ${total} fields filled">${n}/${total}</span>
          </li>`;
        })
        .join('')
    : `<li class="member-empty">No one matches “${esc(state.search)}”.</li>`;
  const idx = activeIndex();
  $('#pager-label').innerHTML = `${esc(active().name || 'Untitled')}<em>${idx + 1}/${members.length}</em>`;
}

// ---------------------------------------------------------- inspector --

const icon = {
  up: '<svg viewBox="0 0 20 20"><path d="m6 12 4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 20 20"><path d="m6 8 4 4 4-4"/></svg>',
  x: '<svg viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8"/></svg>',
  image: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 15 4-4 3 3 2-2 3 3"/></svg>',
};

function rangeField(label, key, value, min, max, step, fmt = (v) => `${Math.round(v * 100)}`, scope = 's') {
  return `<label class="field"><span>${label}</span>
    <div class="range"><input type="range" data-${scope}="${key}" min="${min}" max="${max}" step="${step}" value="${value}">
    <output>${fmt(Number(value))}</output></div></label>`;
}

function colorField(label, key, value) {
  return `<label class="field"><span>${label}</span>
    <div class="color-input"><input type="color" data-s="${key}" value="${esc(value)}" aria-label="${label}">
    <input type="text" data-s="${key}" value="${esc(value)}" spellcheck="false" aria-label="${label} hex"></div></label>`;
}

function valueInput(f, m) {
  const v = m.values[f.id] ?? '';
  const ph = esc(FIELD_TYPES[f.type].placeholder);
  if (f.type === 'quote') return `<textarea class="value-input serif" data-v="${f.id}" rows="2" placeholder="${ph}">${esc(v)}</textarea>`;
  if (f.type === 'list') return `<textarea class="value-input" data-v="${f.id}" rows="2" placeholder="${ph}">${esc(v)}</textarea>`;
  if (f.type === 'emoji') {
    if (isImageValue(v)) {
      return `<div class="emoji-row"><div class="custom-emoji"><img src="${esc(v)}" alt=""><span>Custom emoji</span>
        <button class="icon-btn small" data-action="emoji-clear" data-id="${f.id}" aria-label="Remove custom emoji">${icon.x}</button></div></div>`;
    }
    return `<div class="emoji-row"><input type="text" class="value-input emoji" data-v="${f.id}" value="${esc(v)}" placeholder="${ph}" aria-label="${esc(f.label)}">
      <button class="btn small" data-action="emoji-upload" data-id="${f.id}" title="Upload a custom server emoji">Upload</button></div>`;
  }
  return `<input type="text" class="value-input big" data-v="${f.id}" value="${esc(v)}" placeholder="${ph}" aria-label="${esc(f.label)}">`;
}

function memberTab() {
  const m = active();
  const idx = activeIndex();
  const count = P().members.length;
  return `
  <section class="section">
    <label class="field"><span>Display name</span>
      <input type="text" data-m="name" value="${esc(m.name)}" placeholder="Username" autocomplete="off"></label>
  </section>

  <section class="section">
    <h3 class="section-title">Photo <small>faded + textured on the card</small></h3>
    <div class="photo">
      <button class="photo-thumb${m.avatar ? ' has-img' : ''}" data-action="upload-photo" aria-label="Upload photo"
        style="${m.avatar ? `background-image:url('${esc(m.avatar)}')` : ''}">${m.avatar ? '' : icon.image}</button>
      <div class="photo-actions">
        <button class="btn small" data-action="upload-photo">${m.avatar ? 'Replace' : 'Upload'}</button>
        ${m.avatar ? '<button class="btn small" data-action="reset-photo">Recenter</button><button class="btn small danger" data-action="remove-photo">Remove</button>' : ''}
      </div>
    </div>
    <div class="url-row">
      <input class="input" type="url" id="photo-url" placeholder="…or paste an image link" aria-label="Photo URL">
      <button class="btn small" data-action="load-photo-url">Load</button>
    </div>
    ${m.avatar ? rangeField('Zoom', 'avatarZoom', m.avatarZoom, 1, 4, 0.01, (v) => `${v.toFixed(2)}×`, 'm') : ''}
    ${m.avatar ? '' : '<p class="note">No photo? The card uses a hypercolor gradient in this member’s accent instead.</p>'}
  </section>

  <section class="section">
    <h3 class="section-title">Accent colour</h3>
    <div class="swatches">
      ${ACCENTS.map((a) => `<button class="swatch" style="--c:${a.hex}" data-action="set-accent" data-hex="${a.hex}"
        aria-pressed="${a.hex.toLowerCase() === String(m.accent).toLowerCase()}" title="${a.name}" aria-label="${a.name}"></button>`).join('')}
    </div>
    <div class="color-row">
      <div class="color-input"><input type="color" data-m="accent" value="${esc(m.accent)}" aria-label="Custom accent">
        <input type="text" data-m="accent" value="${esc(m.accent)}" spellcheck="false" aria-label="Accent hex"></div>
      ${m.avatar ? '<button class="btn small" data-action="accent-from-photo" title="Pick a vivid colour from their photo">Match photo</button>' : ''}
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Stats <small>blank = hidden on this card</small></h3>
    ${P().fields.map((f) => `<label class="field"><span>${esc(f.label)}<em>${FIELD_TYPES[f.type].label}</em></span>${valueInput(f, m)}</label>`).join('')}
    ${P().fields.length ? '' : '<p class="note">No fields yet. Add some in the Fields tab.</p>'}
  </section>

  <section class="section">
    <h3 class="section-title">Card</h3>
    <div class="danger-zone">
      <button class="btn small" data-action="move-member" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>Move up</button>
      <button class="btn small" data-action="move-member" data-dir="1" ${idx === count - 1 ? 'disabled' : ''}>Move down</button>
      <button class="btn small" data-action="duplicate-member">Duplicate</button>
      <button class="btn small danger" data-action="delete-member" ${count < 2 ? 'disabled' : ''}>Delete</button>
    </div>
  </section>`;
}

function fieldsTab() {
  const fields = P().fields;
  return `
  <section class="section">
    <h3 class="section-title">Fields <small>shared by every card</small></h3>
    <p class="note">Cards show fields top to bottom in this order. Consecutive stats line up in a row; the first emoji goes on the glass tile in the stub.</p>
    <ul class="schema">
      ${fields.map((f, i) => `
      <li class="schema-item">
        <div class="schema-top">
          <div class="schema-move">
            <button class="icon-btn" data-action="move-field" data-id="${f.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon.up}</button>
            <button class="icon-btn" data-action="move-field" data-id="${f.id}" data-dir="1" ${i === fields.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon.down}</button>
          </div>
          <input type="text" data-f="${f.id}" data-prop="label" value="${esc(f.label)}" aria-label="Field label">
          <button class="icon-btn small" data-action="delete-field" data-id="${f.id}" aria-label="Delete field" title="Delete field">${icon.x}</button>
        </div>
        <div class="schema-bottom">
          <select data-f="${f.id}" data-prop="type" aria-label="Field type">
            ${Object.entries(FIELD_TYPES).map(([k, t]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
          ${f.type === 'stat' ? `<label class="check"><input type="checkbox" data-f="${f.id}" data-prop="wide" ${f.wide ? 'checked' : ''}> Wide (hero number)</label>` : ''}
        </div>
      </li>`).join('')}
    </ul>
    <div class="add-field">
      ${Object.entries(FIELD_TYPES).map(([k, t]) => `<button class="btn small" data-action="add-field" data-type="${k}">+ ${t.label}</button>`).join('')}
    </div>
  </section>
  <section class="section">
    <h3 class="section-title">Field types</h3>
    ${Object.values(FIELD_TYPES).map((t) => `<p class="note" style="margin:0 0 8px"><strong style="color:var(--ink-2)">${t.label}.</strong> ${esc(t.help)}</p>`).join('')}
  </section>`;
}

function styleTab() {
  const { event: ev, style: st } = P();
  const pct = (v) => `${Math.round(v * 100)}`;
  return `
  <section class="section">
    <h3 class="section-title">Event</h3>
    <div class="grid-2">
      <label class="field"><span>Title</span><input type="text" data-e="title" value="${esc(ev.title)}"></label>
      <label class="field"><span>Year</span><input type="text" data-e="year" value="${esc(ev.year)}"></label>
      <label class="field"><span>Subtitle</span><input type="text" data-e="subtitle" value="${esc(ev.subtitle)}"></label>
      <label class="field"><span>Top-right tag</span><input type="text" data-e="admit" value="${esc(ev.admit)}"></label>
    </div>
    <label class="field"><span>Fine print<em>use {name}</em></span><textarea data-e="finePrint" rows="3">${esc(ev.finePrint)}</textarea></label>
    <label class="field"><span>Serial prefix</span><input type="text" data-e="serialPrefix" value="${esc(ev.serialPrefix)}"></label>
  </section>

  <section class="section">
    <h3 class="section-title">Type</h3>
    <label class="field"><span>Display font</span>
      <select data-s="displayFont">${Object.entries(DISPLAY_FONTS).map(([k, f]) => `<option value="${k}" ${k === st.displayFont ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
    ${rangeField('Chromatic aura on name', 'aura', st.aura, 0, 1, 0.01, pct)}
  </section>

  <section class="section">
    <h3 class="section-title">Photo treatment</h3>
    <label class="field"><span>Style</span>
      <select data-s="imageStyle">${Object.entries(IMAGE_STYLES).map(([k, l]) => `<option value="${k}" ${k === st.imageStyle ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${rangeField('Photo strength', 'imageStrength', st.imageStrength, 0, 1, 0.01, pct)}
  </section>

  <section class="section">
    <h3 class="section-title">Texture &amp; glass</h3>
    ${rangeField('Film grain', 'grain', st.grain, 0, 1, 0.01, pct)}
    ${rangeField('Background glow', 'glow', st.glow, 0, 1, 0.01, pct)}
    ${rangeField('Glass see-through', 'glass', st.glass, 0, 1, 0.01, pct)}
  </section>

  <section class="section">
    <h3 class="section-title">Colours</h3>
    <div class="grid-2">
      ${colorField('Background', 'bg', st.bg)}
      ${colorField('Ticket', 'ticket', st.ticket)}
      ${colorField('Text', 'ink', st.ink)}
      ${colorField('Labels', 'muted', st.muted)}
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Export</h3>
    <div class="grid-2">
      <label class="field"><span>Size</span>
        <select data-s="exportScale">
          <option value="1" ${Number(st.exportScale) === 1 ? 'selected' : ''}>1080 × 1350</option>
          <option value="2" ${Number(st.exportScale) === 2 ? 'selected' : ''}>2160 × 2700</option>
        </select></label>
      <label class="field"><span>Format</span>
        <select data-s="exportFormat">
          <option value="png" ${st.exportFormat !== 'jpeg' ? 'selected' : ''}>PNG (lossless)</option>
          <option value="jpeg" ${st.exportFormat === 'jpeg' ? 'selected' : ''}>JPEG (smaller)</option>
        </select></label>
    </div>
    <p class="note" style="margin:0">Grain makes PNGs heavy: about 3&nbsp;MB at 1080, 12&nbsp;MB at 2160. Discord's free upload limit is 10&nbsp;MB, so use JPEG for the big size.</p>
  </section>

  <section class="section">
    <h3 class="section-title">Reset</h3>
    <div class="danger-zone">
      <button class="btn small" data-action="reset-style">Reset style</button>
      <button class="btn small" data-action="new-year" title="Keep fields and style, clear every member's stats">Start a new year</button>
      <button class="btn small danger" data-action="reset-project">Erase everything</button>
    </div>
  </section>`;
}

function renderInspector() {
  document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
  const body = $('#inspector');
  const scroll = body.scrollTop;
  body.innerHTML = state.tab === 'fields' ? fieldsTab() : state.tab === 'style' ? styleTab() : memberTab();
  body.scrollTop = scroll;
}

// ------------------------------------------------------- input binding --

function readInput(t) {
  if (t.type === 'checkbox') return t.checked;
  if (t.type === 'range' || t.type === 'number') return Number(t.value);
  return t.value;
}

const isHex = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v).trim());

function syncSiblings(t, key, value) {
  // Keep colour picker + hex text (and range + output) in step.
  const root = t.closest('.color-input, .range');
  if (!root) return;
  root.querySelectorAll('input').forEach((el) => { if (el !== t) el.value = value; });
  const out = root.querySelector('output');
  if (out) out.textContent = key === 'avatarZoom' ? `${Number(value).toFixed(2)}×` : `${Math.round(value * 100)}`;
}

$('#inspector').addEventListener('input', (e) => {
  const t = e.target;
  const d = t.dataset;
  const m = active();
  if (d.m) {
    let v = readInput(t);
    if (d.m === 'accent') {
      if (!isHex(v)) return;
      v = v.trim().toLowerCase();
      syncSiblings(t, d.m, v);
      document.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', s.dataset.hex === v));
    } else syncSiblings(t, d.m, v);
    m[d.m] = v;
    delete m.sample;
    changed({ members: d.m === 'name' || d.m === 'accent' });
  } else if (d.v) {
    m.values[d.v] = t.value;
    delete m.sample;
    changed({ members: true });
  } else if (d.s) {
    let v = readInput(t);
    if (t.type === 'color' || (t.type === 'text' && t.closest('.color-input'))) {
      if (!isHex(v)) return;
    }
    if (d.s === 'exportScale') v = Number(v);
    syncSiblings(t, d.s, v);
    P().style[d.s] = v;
    changed();
  } else if (d.e) {
    P().event[d.e] = t.value;
    changed();
  } else if (d.f) {
    const f = P().fields.find((x) => x.id === d.f);
    if (!f) return;
    f[d.prop] = readInput(t);
    changed({ members: d.prop === 'type', inspector: d.prop === 'type' });
  }
});

$('#member-search').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderMembers();
});

// ------------------------------------------------------------ actions --

function selectMember(id) {
  if (!P().members.some((m) => m.id === id)) return;
  P().activeId = id;
  changed({ members: true, inspector: state.tab === 'member' });
  $(`.member-item[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}

function step(dir) {
  const ms = P().members;
  const i = (activeIndex() + dir + ms.length) % ms.length;
  selectMember(ms[i].id);
}

function pickFile(id) {
  return new Promise((resolve) => {
    const input = $(id);
    input.value = '';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

async function setPhoto(file) {
  try {
    const m = active();
    m.avatar = await fileToDataUrl(file);
    Object.assign(m, { avatarZoom: 1, avatarX: 0.5, avatarY: 0.4 });
    delete m.sample;
    changed({ members: true, inspector: state.tab === 'member' });
  } catch (err) {
    toast(err.message || 'Could not read that image.', { error: true });
  }
}

async function exportAll() {
  const members = P().members;
  const scale = Number(P().style.exportScale) || 1;
  const files = [];
  try {
    for (let i = 0; i < members.length; i++) {
      toast(`Rendering ${members[i].name || 'card'} (${i + 1}/${members.length})…`, { sticky: true, progress: i / members.length });
      const blob = await renderToBlob(members[i], i, scale);
      files.push({ name: fileName(members[i], i), data: new Uint8Array(await blob.arrayBuffer()) });
    }
    download(makeZip(files), `${slug(P().event.title)}-recap-${slug(P().event.year)}.zip`);
    toast(`Exported ${files.length} card${files.length === 1 ? '' : 's'}.`);
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err.message}`, { error: true });
  }
}

const HEADER_ALIASES = {
  name: ['name', 'username', 'user', 'member', 'display name', 'displayname'],
  accent: ['accent', 'color', 'colour', 'accent color', 'accent colour'],
  avatar: ['avatar', 'avatar url', 'avatar_url', 'pfp', 'photo', 'image', 'profile picture'],
};
const norm = (s) => String(s || '').trim().toLowerCase().replace(/[_-]+/g, ' ');

function downloadCsv() {
  const fields = P().fields;
  const rows = [['name', 'accent', 'avatar_url', ...fields.map((f) => f.label)]];
  for (const m of P().members) {
    rows.push([m.name, m.accent, m.avatar && !m.avatar.startsWith('data:') ? m.avatar : '',
      ...fields.map((f) => (isImageValue(m.values[f.id]) ? '' : m.values[f.id] ?? ''))]);
  }
  download(new Blob([toCsv(rows)], { type: 'text/csv' }), `${slug(P().event.title)}-recap-${slug(P().event.year)}.csv`);
  toast('Spreadsheet downloaded. Fill it in, then use Import CSV.');
}

async function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return toast('That CSV has no data rows.', { error: true });
  const headers = rows[0].map(norm);
  const col = (key) => headers.findIndex((h) => HEADER_ALIASES[key].includes(h));
  const nameCol = col('name') >= 0 ? col('name') : 0;
  const accentCol = col('accent');
  const avatarCol = col('avatar');
  const p = P();

  // Map remaining columns to fields (creating any that don't exist yet).
  const created = [];
  const fieldCols = [];
  headers.forEach((h, i) => {
    if ([nameCol, accentCol, avatarCol].includes(i) || !h) return;
    let f = p.fields.find((x) => norm(x.label) === h);
    if (!f) {
      f = { id: uid(), label: rows[0][i].trim(), type: 'stat' };
      p.fields.push(f);
      created.push(f.label);
    }
    fieldCols.push([i, f]);
  });

  // First import replaces the untouched sample card.
  if (p.members.every((m) => m.sample)) p.members = [];

  let added = 0, updated = 0;
  const avatarJobs = [];
  for (const r of rows.slice(1)) {
    const name = (r[nameCol] || '').trim();
    if (!name) continue;
    let m = p.members.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (m) updated++;
    else {
      m = { ...blankMember(nextAccent(p.members)), name };
      p.members.push(m);
      added++;
    }
    delete m.sample;
    if (accentCol >= 0 && isHex(r[accentCol] || '')) m.accent = r[accentCol].trim().toLowerCase();
    for (const [i, f] of fieldCols) if (r[i] !== undefined && r[i].trim() !== '') m.values[f.id] = r[i].trim();
    const url = avatarCol >= 0 ? (r[avatarCol] || '').trim() : '';
    if (url) avatarJobs.push(urlToDataUrl(url).then((d) => { m.avatar = d; }).catch(() => m.name));
  }
  if (!p.members.length) p.members.push(blankMember());
  if (!p.members.some((m) => m.id === p.activeId)) p.activeId = p.members[0].id;

  const failed = (await Promise.all(avatarJobs)).filter((x) => typeof x === 'string');
  changed({ members: true, inspector: true });
  let msg = `Imported ${added} new, updated ${updated}.`;
  if (created.length) msg += ` New fields: ${created.join(', ')}.`;
  if (failed.length) msg += ` Couldn't load photos for: ${failed.join(', ')}.`;
  toast(msg, { error: failed.length > 0 });
}

function saveProject() {
  const data = JSON.stringify({ ...P(), savedAt: new Date().toISOString() });
  download(new Blob([data], { type: 'application/json' }), `${slug(P().event.title)}-recap-${slug(P().event.year)}.json`);
  toast('Project saved. Keep this file as a backup, or open it on another computer.');
}

function openProject(text) {
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data.members)) throw new Error('not a project file');
    state.project = normalizeProject(data);
    changed({ members: true, inspector: true });
    toast(`Opened project with ${P().members.length} members.`);
  } catch (err) {
    toast(`Couldn't open that file (${err.message}).`, { error: true });
  }
}

async function handleFile(file) {
  if (!file) return;
  if (file.type.startsWith('image/')) return setPhoto(file);
  const text = await file.text();
  if (/\.json$/i.test(file.name) || file.type === 'application/json') return openProject(text);
  if (/\.(csv|tsv|txt)$/i.test(file.name) || file.type.includes('csv')) return importCsv(text);
  toast('Drop an image, a .csv, or a project .json.', { error: true });
}

const actions = {
  'select-member': (el) => selectMember(el.dataset.id),
  prev: () => step(-1),
  next: () => step(1),
  tab: (el) => { state.tab = el.dataset.tab; renderInspector(); },
  'add-member': () => {
    const m = blankMember(nextAccent(P().members));
    P().members.push(m);
    P().activeId = m.id;
    state.tab = 'member';
    changed({ members: true, inspector: true });
    setTimeout(() => { const i = $('[data-m="name"]'); i?.focus(); i?.select(); }, 0);
  },
  'duplicate-member': () => {
    const src = active();
    const copy = { ...structuredClone(src), id: uid(), name: `${src.name} copy` };
    delete copy.sample;
    P().members.splice(activeIndex() + 1, 0, copy);
    P().activeId = copy.id;
    changed({ members: true, inspector: true });
  },
  'delete-member': () => {
    const m = active();
    if (P().members.length < 2 || !confirm(`Delete ${m.name || 'this card'}?`)) return;
    const i = activeIndex();
    P().members.splice(i, 1);
    P().activeId = P().members[Math.min(i, P().members.length - 1)].id;
    changed({ members: true, inspector: true });
  },
  'move-member': (el) => {
    const i = activeIndex(), j = i + Number(el.dataset.dir);
    const ms = P().members;
    if (j < 0 || j >= ms.length) return;
    [ms[i], ms[j]] = [ms[j], ms[i]];
    changed({ members: true, inspector: true });
  },
  'set-accent': (el) => { active().accent = el.dataset.hex; changed({ members: true, inspector: true }); },
  'accent-from-photo': async () => {
    const img = await loadImage(active().avatar);
    const c = img && extractAccent(img);
    if (!c) return toast('Couldn’t find a strong colour in that photo.', { error: true });
    active().accent = c;
    changed({ members: true, inspector: true });
  },
  'upload-photo': async () => setPhoto(await pickFile('#file-photo')),
  'remove-photo': () => { active().avatar = null; changed({ members: true, inspector: true }); },
  'reset-photo': () => {
    Object.assign(active(), { avatarZoom: 1, avatarX: 0.5, avatarY: 0.4 });
    changed({ inspector: true });
  },
  'load-photo-url': async () => {
    const url = $('#photo-url')?.value.trim();
    if (!url) return;
    try {
      toast('Loading photo…', { sticky: true });
      active().avatar = await urlToDataUrl(url);
      Object.assign(active(), { avatarZoom: 1, avatarX: 0.5, avatarY: 0.4 });
      changed({ members: true, inspector: true });
      toast('Photo added.');
    } catch (err) {
      toast(err.message, { error: true });
    }
  },
  'emoji-upload': async (el) => {
    const file = await pickFile('#file-emoji');
    if (!file) return;
    try {
      active().values[el.dataset.id] = await fileToDataUrl(file, 256);
      changed({ members: true, inspector: true });
    } catch (err) {
      toast(err.message, { error: true });
    }
  },
  'emoji-clear': (el) => { active().values[el.dataset.id] = ''; changed({ members: true, inspector: true }); },
  'add-field': (el) => {
    const type = el.dataset.type;
    P().fields.push({ id: uid(), label: `New ${FIELD_TYPES[type].label.toLowerCase()}`, type });
    changed({ members: true, inspector: true });
    setTimeout(() => { const inputs = document.querySelectorAll('.schema-item input[type=text]'); inputs[inputs.length - 1]?.select(); }, 0);
  },
  'delete-field': (el) => {
    const f = P().fields.find((x) => x.id === el.dataset.id);
    const used = P().members.filter((m) => String(m.values[f.id] ?? '').trim()).length;
    if (used && !confirm(`Delete “${f.label}”? ${used} card${used === 1 ? ' has' : 's have'} a value for it.`)) return;
    P().fields = P().fields.filter((x) => x !== f);
    for (const m of P().members) delete m.values[f.id];
    changed({ members: true, inspector: true });
  },
  'move-field': (el) => {
    const fs = P().fields;
    const i = fs.findIndex((x) => x.id === el.dataset.id), j = i + Number(el.dataset.dir);
    if (j < 0 || j >= fs.length) return;
    [fs[i], fs[j]] = [fs[j], fs[i]];
    changed({ inspector: true });
  },
  download: async () => {
    const m = active();
    const blob = await renderToBlob(m, activeIndex(), Number(P().style.exportScale) || 1);
    download(blob, fileName(m, activeIndex()));
  },
  'export-all': exportAll,
  'import-csv': async () => handleFile(await pickFile('#file-csv')),
  'download-csv': downloadCsv,
  'save-project': saveProject,
  'open-project': async () => handleFile(await pickFile('#file-project')),
  'reset-style': () => {
    if (!confirm('Reset fonts, colours and effects to the defaults?')) return;
    P().style = defaultProject().style;
    changed({ inspector: true });
  },
  'new-year': () => {
    if (!confirm('Clear every member’s stats (keeping names, photos, fields and style)?')) return;
    for (const m of P().members) m.values = {};
    const y = parseInt(P().event.year, 10);
    if (y) P().event.year = String(y + 1);
    changed({ members: true, inspector: true });
    toast('Fresh year. Happy recapping!');
  },
  'reset-project': () => {
    if (!confirm('Erase all members, photos and settings? Save a project file first if you might want them back.')) return;
    state.project = freshProject();
    changed({ members: true, inspector: true });
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(el);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});

// ---------------------------------------------------- drag & drop files --

const stage = $('#stage');
let dragDepth = 0;
stage.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; stage.classList.add('dragover'); } });
stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove('dragover'); } });
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});

// ---------------------------------------- drag / wheel to frame the photo --

const canvas = $('#card');
function toCard(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * CARD_W, y: ((e.clientY - r.top) / r.height) * CARD_H };
}
function inHero(pt) {
  const h = state.geometry?.hero;
  return h?.geo && pt.x >= h.x && pt.x <= h.x + h.w && pt.y >= h.y && pt.y <= h.y + h.h;
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  const pt = toCard(e);
  if (!inHero(pt)) return;
  const m = active();
  drag = { pt, x: m.avatarX, y: m.avatarY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { hero } = state.geometry;
  const pt = toCard(e);
  const m = active();
  const ox = hero.geo.dw - hero.w, oy = hero.geo.dh - hero.h;
  if (ox > 1) m.avatarX = Math.max(0, Math.min(1, drag.x - (pt.x - drag.pt.x) / ox));
  if (oy > 1) m.avatarY = Math.max(0, Math.min(1, drag.y - (pt.y - drag.pt.y) / oy));
  scheduleRender();
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  canvas.classList.remove('dragging');
  persist();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  if (!inHero(toCard(e))) return;
  e.preventDefault();
  const m = active();
  m.avatarZoom = Math.max(1, Math.min(4, (Number(m.avatarZoom) || 1) * Math.exp(-e.deltaY * 0.0015)));
  const slider = $('[data-m="avatarZoom"]');
  if (slider) {
    slider.value = m.avatarZoom;
    syncSiblings(slider, 'avatarZoom', m.avatarZoom);
  }
  scheduleRender();
  persist();
}, { passive: false });

// --------------------------------------------------------------- boot --

function freshProject() {
  const p = defaultProject();
  p.members[0].sample = true;
  return p;
}

async function boot() {
  const saved = await storage.load('project');
  state.project = saved ? normalizeProject(saved) : freshProject();
  await ensureFonts();
  renderMembers();
  renderInspector();
  applyAccent();
  scheduleRender();
  $('#save-state').textContent = saved ? 'Saved' : '';
}

boot();
