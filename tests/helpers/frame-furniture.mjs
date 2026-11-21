// The frame-furniture invariant (ADR 004, D7 step 1), read from a composed
// DisplayList rather than predicted from layout formulas: every check below
// looks at what the frame draws. The frame spec is used only for its
// declared contract (frame size, band and legend safe areas, narration line
// count), never to recompute where the composer put something.
import { walkDisplayItems } from '../../packages/render/src/display-list.ts';
import { furnitureOf } from '../../packages/render/src/frame-spec.ts';

export const intersects = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const SLACK = 0.5;
export const inside = (outer, inner) =>
  inner.x >= outer.x - SLACK &&
  inner.y >= outer.y - SLACK &&
  inner.x + inner.w <= outer.x + outer.w + SLACK &&
  inner.y + inner.h <= outer.y + outer.h + SLACK;
const show = (r) => `[${[r.x, r.y, r.w, r.h].map((n) => Math.round(n)).join(',')}]`;

/** The box a text item covers: its measured advance, ascent 0.85 and height 1.1 of its size. */
export function textBox(item, measure) {
  const w = measure(item.text, item.font),
    size = item.font.size;
  const x = item.align === 'center' ? item.x - w / 2 : item.align === 'right' ? item.x - w : item.x;
  const top =
    item.baseline === 'top'
      ? item.y
      : item.baseline === 'middle'
        ? item.y - size / 2
        : item.y - size * 0.85;
  return { x, y: top, w, h: size * 1.1 };
}

/** Bounds of a path's commands (rectangles, rounded rectangles, lines). */
function pathBox(item) {
  const xs = [],
    ys = [];
  for (const c of item.d) {
    if (c[0] === 'R' || c[0] === 'RR') (xs.push(c[1], c[1] + c[3]), ys.push(c[2], c[2] + c[4]));
    else if (c[0] === 'M' || c[0] === 'L') (xs.push(c[1]), ys.push(c[2]));
  }
  if (!xs.length) return null;
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
const rrBox = (item) =>
  item.type === 'path' && item.d.length === 1 && item.d[0][0] === 'RR'
    ? { x: item.d[0][1], y: item.d[0][2], w: item.d[0][3], h: item.d[0][4] }
    : null;

/** Top-level items with their groups' contents in order, keeping only drawables. */
const flat = (items) => [...walkDisplayItems(items)];

/**
 * Everything the furniture invariant is about, found in the drawn list:
 * the band fills, the stage clip and its texts, legend plates, edge-label
 * plates, node labels, the evidence card's and detail card's plates, and the
 * furniture texts.
 */
export function readFrame(list, theme, measure) {
  const stageGroup = list.items.find((item) => item.type === 'group' && item.clip);
  const stage = stageGroup?.clip ?? null;
  const top = list.items.filter((item) => item !== stageGroup);
  const topItems = flat(top);
  const bands = topItems
    .filter((item) => item.type === 'path' && item.fill === theme.band)
    .map(pathBox);
  const plates = topItems.filter((item) => item.type === 'path' && item.fill === theme.card);
  // A card plate holds the texts drawn right after it; the evidence card's
  // first text is its EVIDENCE kicker.
  const cards = { evidence: null, detail: null };
  const cardTexts = new Set();
  for (const plate of plates) {
    const box = rrBox(plate);
    const index = topItems.indexOf(plate);
    const following = [];
    for (const item of topItems.slice(index + 1)) {
      if (item.type === 'path' && item.fill === theme.card) break;
      if (item.type === 'text' && inside(box, textBox(item, measure))) following.push(item);
      else if (item.type === 'text') break;
    }
    following.forEach((item) => cardTexts.add(item));
    if (following[0]?.text === 'EVIDENCE') cards.evidence = { box, texts: following };
    else cards.detail = { box, texts: following };
  }
  const furnitureTexts = topItems.filter((item) => item.type === 'text' && !cardTexts.has(item));
  const stageItems = stageGroup ? flat(stageGroup.items) : [];
  const legendPlates = stageItems
    .filter((item) => item.type === 'path' && item.fill === theme.legendPlate)
    .map(rrBox);
  const legendTexts = stageItems.filter(
    (item) => item.type === 'text' && item.fill === theme.legendText && !item.align,
  );
  const edgeLabelPlates = stageItems
    .filter((item) => item.type === 'path' && item.fill === theme.edgeLabelBox)
    .map(rrBox);
  const stageTexts = stageItems.filter((item) => item.type === 'text');
  const nodeLabels = stageTexts.filter(
    (item) => item.halo && item.baseline === 'top' && item.fill !== theme.legendText,
  );
  const narration = furnitureTexts.filter((item) => item.fill === theme.narration);
  const track = topItems.find((item) => item.type === 'path' && item.fill === theme.track);
  return {
    stage,
    bands,
    cards,
    furnitureTexts,
    legendPlates,
    legendTexts,
    edgeLabelPlates,
    stageTexts,
    nodeLabels,
    narration,
    track: track ? pathBox(track) : null,
  };
}

/**
 * Problems of one frame; empty when the invariant holds. `narration` is the
 * shot's narration as written, to check that a narration that fits the
 * spec's line count is drawn whole.
 */
export function furnitureProblems(list, spec, theme, measure, { narration = '' } = {}) {
  const f = readFrame(list, theme, measure);
  const furniture = furnitureOf(spec);
  const frame = { x: 0, y: 0, w: spec.width, h: spec.height };
  const problems = [];
  const add = (problem) => problems.push(problem);
  if (list.width !== spec.width || list.height !== spec.height)
    add(`frame ${list.width}×${list.height}, spec ${spec.width}×${spec.height}`);
  if (f.bands.length !== 2) add(`${f.bands.length} band fills`);
  const [titleBand, captionBand] = [...f.bands].sort((a, b) => a.y - b.y);
  for (const band of f.bands) if (!inside(frame, band)) add(`band ${show(band)} leaves the frame`);
  if (titleBand && captionBand && intersects(titleBand, captionBand)) add('bands overlap');
  // The stage, which clips the graph and its labels, lies between the bands.
  if (!f.stage) add('no stage clip');
  else {
    if (!inside(frame, f.stage)) add('stage leaves the frame');
    for (const band of f.bands)
      if (intersects(band, f.stage)) add(`stage ${show(f.stage)} enters band ${show(band)}`);
  }
  // Furniture text: inside a band and its safe area, never over another text.
  const safeBands = [spec.safe.title, spec.safe.caption];
  const byBand = new Map();
  for (const item of f.furnitureTexts) {
    const box = textBox(item, measure);
    const band = f.bands.find((b) => inside(b, box));
    const safe = safeBands.find((s) => box.x >= s.x - SLACK && box.x + box.w <= s.x + s.w + SLACK);
    if (!band) add(`furniture text "${item.text}" ${show(box)} outside the bands`);
    else if (!safe) add(`furniture text "${item.text}" ${show(box)} outside the safe width`);
    if (band) {
      const others = byBand.get(band) ?? [];
      for (const other of others)
        if (intersects(other.box, box)) add(`"${other.text}" overlaps "${item.text}"`);
      others.push({ box, text: item.text });
      byBand.set(band, others);
    }
  }
  // Narration: at most the spec's line count, above the progress track, and
  // drawn whole when it fits.
  if (f.narration.length > furniture.narrationLines)
    add(`${f.narration.length} narration lines > ${furniture.narrationLines}`);
  if (f.track) {
    if (!captionBand || !inside(captionBand, f.track)) add('progress track outside caption band');
    for (const line of f.narration)
      if (textBox(line, measure).y + textBox(line, measure).h > f.track.y + SLACK)
        add(`narration "${line.text}" reaches the progress track`);
  } else add('no progress track');
  const drawnNarration = f.narration.map((item) => item.text).join('');
  if (
    narration &&
    f.narration.length &&
    drawnNarration !== narration.replaceAll('\n', '') &&
    f.narration.length < furniture.narrationLines
  )
    add(`narration cut at ${f.narration.length} of ${furniture.narrationLines} lines`);
  // Legend: whole plates on the stage, in the legend strip when the spec has
  // one, clear of the bands, the cards and every other text of the stage.
  for (const plate of f.legendPlates) {
    if (f.stage && !inside(f.stage, plate)) add(`legend ${show(plate)} leaves the stage`);
    if (spec.safe.legend && !inside(spec.safe.legend, plate))
      add(`legend ${show(plate)} outside safe.legend`);
    for (const band of f.bands) if (intersects(band, plate)) add('legend enters a band');
    for (const [name, card] of Object.entries(f.cards))
      if (card && intersects(card.box, plate)) add(`legend under the ${name} card`);
    for (const text of f.stageTexts)
      if (!f.legendTexts.includes(text) && intersects(textBox(text, measure), plate))
        add(`legend over "${text.text}"`);
    for (const other of f.edgeLabelPlates)
      if (intersects(other, plate)) add('legend over a relation label');
  }
  for (const text of f.legendTexts)
    if (!f.legendPlates.some((plate) => inside(plate, textBox(text, measure))))
      add(`legend text "${text.text}" outside its plate`);
  // Cards: inside the frame, clear of the bands, of each other and of labels.
  for (const [name, card] of Object.entries(f.cards)) {
    if (!card) continue;
    if (!inside(frame, card.box)) add(`${name} card leaves the frame`);
    for (const band of f.bands) if (intersects(band, card.box)) add(`${name} card enters a band`);
    for (const text of card.texts)
      if (!inside(card.box, textBox(text, measure))) add(`${name} card text outside its plate`);
  }
  if (f.cards.evidence && f.cards.detail && intersects(f.cards.evidence.box, f.cards.detail.box))
    add('evidence card overlaps the detail card');
  if (f.cards.evidence) {
    const card = f.cards.evidence.box;
    for (const label of f.nodeLabels)
      if (intersects(textBox(label, measure), card)) add(`node label "${label.text}" under card`);
    for (const plate of f.edgeLabelPlates)
      if (intersects(plate, card)) add('relation label under card');
  }
  // Labels never enter a band.
  for (const label of f.nodeLabels)
    for (const band of f.bands)
      if (intersects(textBox(label, measure), band)) add(`label "${label.text}" enters a band`);
  for (const plate of f.edgeLabelPlates)
    for (const band of f.bands) if (intersects(plate, band)) add('relation label enters a band');
  return problems;
}
