// The time-direction invariant (ADR 004, D7 step 2), read from a composed
// DisplayList: every check looks at what the frame draws, never at where a
// formula says the composer should have put it. The stored positions are
// used only as the data the picture must keep in order.
import { walkDisplayItems } from '../../packages/render/src/display-list.ts';
import { inside, intersects, readFrame, textBox } from './frame-furniture.mjs';

const EPSILON = 1e-6;
const show = (r) => `[${[r.x, r.y, r.w, r.h].map((n) => Math.round(n)).join(',')}]`;
const centre = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

/**
 * What the time axis draws: its rule labels (monospaced, in the legend's
 * colour), its rules and its cursor, from the stage's items.
 */
export function readTimeAxis(list, theme) {
  const stage = list.items.find((item) => item.type === 'group' && item.clip);
  const items = stage ? [...walkDisplayItems(stage.items)] : [];
  const labels = items.filter(
    (item) => item.type === 'text' && item.font.family === 'mono' && item.fill === theme.legendText,
  );
  const lines = (item) => {
    const segments = [];
    for (let i = 1; i < item.d.length; i++)
      if (item.d[i][0] === 'L' && (item.d[i - 1][0] === 'M' || item.d[i - 1][0] === 'L'))
        segments.push([item.d[i - 1], item.d[i]]);
    return segments;
  };
  const rules = items
    .filter((item) => item.type === 'path' && item.stroke === theme.bandRule)
    .flatMap(lines);
  const cursor = items
    .filter((item) => item.type === 'path' && item.stroke === theme.progress)
    .flatMap(lines);
  return { labels, rules, cursor };
}

/**
 * Problems of one frame; empty when the invariant holds.
 *
 * - order: of two drawn nodes, the one stored further along x is drawn
 *   further down when time runs vertically (further right otherwise), and
 *   the one stored further along y further right (further down): the
 *   picture is the stored drawing, transposed or not, at one positive scale;
 * - bars: a timeline bar runs along the direction of time;
 * - axis: the rules run across time (horizontal lines when time runs down),
 *   their labels read in time order along it, inside the stage and clear of
 *   the bands, the legend strip, the legend plates, the evidence card and
 *   every node label; the cursor runs across time too.
 */
export function timeDirectionProblems(
  list,
  spec,
  theme,
  measure,
  { vertical, positions, bars = new Set() },
) {
  const problems = [];
  const add = (problem) => problems.push(problem);
  const drawn = (list.selection ?? []).filter((entry) => entry.kind === 'node' && entry.box);
  // Order: the stored drawing, transposed when time runs down.
  const along = vertical ? ['y', 'x'] : ['x', 'y'];
  for (let i = 0; i < drawn.length; i++)
    for (let j = 0; j < drawn.length; j++) {
      if (i === j) continue;
      const a = drawn[i],
        b = drawn[j];
      const pa = positions.get(a.id),
        pb = positions.get(b.id);
      if (!pa || !pb) continue;
      const ca = centre(a.box),
        cb = centre(b.box);
      const tolerance = EPSILON * Math.max(1, Math.abs(ca.x), Math.abs(ca.y));
      if (pa.x < pb.x && !(ca[along[0]] < cb[along[0]] + tolerance))
        add(`${a.id} is stored before ${b.id} along x but drawn after it along ${along[0]}`);
      if (pa.y < pb.y && !(ca[along[1]] < cb[along[1]] + tolerance))
        add(`${a.id} is stored before ${b.id} along y but drawn after it along ${along[1]}`);
    }
  // Bars run along time.
  for (const entry of drawn)
    if (bars.has(entry.id)) {
      const { w, h } = entry.box;
      if (vertical ? w > h + 0.5 : h > w + 0.5)
        add(`bar ${entry.id} ${show(entry.box)} runs across time`);
    }
  // The axis.
  const axis = readTimeAxis(list, theme);
  for (const [a, b] of axis.rules)
    if (vertical ? Math.abs(a[2] - b[2]) > EPSILON : Math.abs(a[1] - b[1]) > EPSILON)
      add(`rule from (${Math.round(a[1])},${Math.round(a[2])}) runs along time`);
  for (const [a, b] of axis.cursor)
    if (vertical ? Math.abs(a[2] - b[2]) > EPSILON : Math.abs(a[1] - b[1]) > EPSILON) {
      // The cursor's head is a small triangle; only its long line counts.
      const length = Math.hypot(b[1] - a[1], b[2] - a[2]);
      if (length > 20 * spec.typeScale) add('cursor runs along time');
    }
  const f = readFrame(list, theme, measure);
  const labels = axis.labels.map((item) => ({ item, box: textBox(item, measure) }));
  const ordered = [...labels].sort((m, n) => Number(m.item.text) - Number(n.item.text));
  for (let i = 1; i < ordered.length; i++) {
    const before = centre(ordered[i - 1].box)[along[0]],
      after = centre(ordered[i].box)[along[0]];
    if (!(before < after))
      add(`axis label ${ordered[i - 1].item.text} not before ${ordered[i].item.text}`);
  }
  for (const { item, box } of labels) {
    const name = `axis label ${item.text} ${show(box)}`;
    if (f.stage && !inside(f.stage, box)) add(`${name} leaves the stage`);
    for (const band of f.bands) if (intersects(band, box)) add(`${name} enters a band`);
    if (spec.safe.legend && intersects(spec.safe.legend, box)) add(`${name} in the legend strip`);
    for (const plate of f.legendPlates)
      if (intersects(plate, box)) add(`${name} under a legend plate`);
    if (f.cards.evidence && intersects(f.cards.evidence.box, box))
      add(`${name} under the evidence card`);
    if (f.cards.detail && intersects(f.cards.detail.box, box)) add(`${name} under the detail card`);
    for (const label of f.nodeLabels)
      if (intersects(textBox(label, measure), box)) add(`${name} over node label ${label.text}`);
  }
  return problems;
}
