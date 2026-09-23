// Project data model + defaults. A "project" is one year's recap: the event
// details, shared style, the field schema, and every member's values.

export const FIELD_TYPES = {
  stat: {
    label: 'Stat',
    help: 'A big number or short value in the member’s accent colour. Tick “Wide” to make it the hero number.',
    placeholder: '20408',
  },
  quote: {
    label: 'Quote',
    help: 'A line of text set in italic serif. Great for vibes, titles, inside jokes.',
    placeholder: 'aurora’s mom, monster fueled top ramen champion',
  },
  list: {
    label: 'Ranked list',
    help: 'Names with optional counts: “Cody (143), Devon (77)”. Comma or line separated.',
    placeholder: 'Cody (143), Devon (77), Safoof (47)',
  },
  emoji: {
    label: 'Emoji',
    help: 'Shown on the glass tile in the ticket stub. Paste an emoji, or upload a custom server emoji.',
    placeholder: '😭',
  },
};

export const ACCENTS = [
  { name: 'Vermilion', hex: '#ff4d1f' },
  { name: 'Tangerine', hex: '#ff8c1a' },
  { name: 'Sunflower', hex: '#ffd23f' },
  { name: 'Acid', hex: '#c6f432' },
  { name: 'Mint', hex: '#3deb8f' },
  { name: 'Aqua', hex: '#3fd9e8' },
  { name: 'Cobalt', hex: '#4f7dff' },
  { name: 'Violet', hex: '#9d5cff' },
  { name: 'Orchid', hex: '#d86bff' },
  { name: 'Hot pink', hex: '#ff4fa3' },
  { name: 'Blush', hex: '#ff9ec7' },
  { name: 'Pearl', hex: '#ece5d8' },
];

export const DISPLAY_FONTS = {
  unbounded: { label: 'Unbounded: wide & loud', family: "'Unbounded'", weight: 800, tracking: -0.035 },
  archivo: { label: 'Archivo Black: classic heavy', family: "'Archivo Black'", weight: 400, tracking: -0.025 },
  intertight: { label: 'Inter Tight: clean grotesk', family: "'Inter Tight'", weight: 800, tracking: -0.045 },
  bricolage: { label: 'Bricolage: characterful', family: "'Bricolage Grotesque'", weight: 800, tracking: -0.04 },
  syne: { label: 'Syne: art-school', family: "'Syne'", weight: 800, tracking: -0.02 },
  serif: { label: 'Instrument Serif: editorial', family: "'Instrument Serif'", weight: 400, tracking: -0.02 },
};

export const IMAGE_STYLES = {
  duotone: 'Duotone (accent)',
  mono: 'Black & white',
  halftone: 'Halftone dots',
  natural: 'Natural colour',
};

export const uid = () => Math.random().toString(36).slice(2, 10);

export function defaultProject() {
  const fields = [
    { id: uid(), label: 'This year your vibes were', type: 'quote' },
    { id: uid(), label: 'Messages sent', type: 'stat', wide: true },
    { id: uid(), label: 'Voice hours', type: 'stat' },
    { id: uid(), label: 'Level rank', type: 'stat' },
    { id: uid(), label: 'Most mentioned', type: 'list' },
    { id: uid(), label: 'Top emoji', type: 'emoji' },
  ];
  const [vibes, msgs, voice, rank, mentions, emoji] = fields.map((f) => f.id);
  const member = {
    ...blankMember(),
    name: 'Anette',
    accent: '#ff4d1f',
    values: {
      [vibes]: 'aurora’s mom, monster fueled top ramen champion',
      [msgs]: '20408',
      [voice]: '107',
      [rank]: '#30',
      [mentions]: 'Cody (143), Devon (77), Safoof (47)',
      [emoji]: '😭',
    },
  };
  return {
    version: 1,
    event: {
      title: 'Fireside',
      subtitle: 'Recap',
      year: '2025',
      admit: 'Admit one',
      serialPrefix: 'FSR',
      finePrint:
        'Good for one (1) more year by the fire. Non-transferable, non-refundable, deeply appreciated. Thank you for being here, {name}.',
    },
    style: {
      displayFont: 'unbounded',
      imageStyle: 'duotone',
      imageStrength: 0.9,
      grain: 0.4,
      aura: 0.35,
      glow: 0.75,
      glass: 0.35,
      bg: '#08080a',
      ticket: '#131315',
      ink: '#f2efe9',
      muted: '#8e8a85',
      exportScale: 1,
      exportFormat: 'png',
    },
    fields,
    members: [member],
    activeId: member.id,
  };
}

export function blankMember(accent = ACCENTS[0].hex) {
  return {
    id: uid(),
    name: 'New member',
    avatar: null,
    avatarZoom: 1,
    avatarX: 0.5,
    avatarY: 0.4,
    accent,
    values: {},
  };
}

/** Pick an accent that's least used so far, so the set of cards stays varied. */
export function nextAccent(members) {
  const counts = new Map(ACCENTS.map((a) => [a.hex, 0]));
  for (const m of members) if (counts.has(m.accent)) counts.set(m.accent, counts.get(m.accent) + 1);
  let best = ACCENTS[0].hex;
  for (const a of ACCENTS.slice(0, -1)) if (counts.get(a.hex) < counts.get(best)) best = a.hex;
  return best;
}

/** Fill in anything missing from an older / hand-edited project file. */
export function normalizeProject(p) {
  const d = defaultProject();
  if (!p || typeof p !== 'object' || !Array.isArray(p.members)) return d;
  const out = {
    ...d,
    ...p,
    event: { ...d.event, ...(p.event || {}) },
    style: { ...d.style, ...(p.style || {}) },
    fields: Array.isArray(p.fields) ? p.fields.filter((f) => f && f.id && FIELD_TYPES[f.type]) : d.fields,
    members: p.members.map((m) => ({ ...blankMember(), ...m, values: { ...(m.values || {}) } })),
  };
  if (!out.members.length) out.members = [blankMember()];
  if (!out.members.some((m) => m.id === out.activeId)) out.activeId = out.members[0].id;
  return out;
}

export const slug = (s) =>
  String(s || 'member')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'member';
