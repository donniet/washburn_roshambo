// Washburn Roshambo — views.
// Three views: a single Roshambo match, the whole population, and the simulation charts.
// Pure helpers are exported (and tested); DOM code only runs when a view is created.

import { STAFF } from './game.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- pure helpers ----------

export const MOVE_GLYPHS = { rock: '✊', paper: '✋', scissors: '✌️' };
export const moveGlyph = (move) => MOVE_GLYPHS[move] ?? '?';

// Running score after each round: [{ a, b, result, scoreA, scoreB }]
export function matchSummary(rounds) {
  let scoreA = 0, scoreB = 0;
  return rounds.map((r) => {
    if (r.result > 0) scoreA++;
    else if (r.result < 0) scoreB++;
    return { ...r, scoreA, scoreB };
  });
}

export function classifyHolder(blue, gold) {
  if (blue > 0 && gold > 0) return 'both';
  if (gold > 0) return 'gold';
  if (blue > 0) return 'blue';
  return 'none';
}

// Largest square cell (≤ maxCell) that fits n cells in width × maxHeight.
export function gridLayout(n, width, maxHeight, maxCell = 24) {
  for (let cell = maxCell; cell > 1; cell--) {
    const cols = Math.floor(width / cell);
    const rows = Math.ceil(n / cols);
    if (rows * cell <= maxHeight) return { cols, rows, cell, height: rows * cell };
  }
  const cols = Math.floor(width);
  return { cols, rows: Math.ceil(n / cols), cell: 1, height: Math.ceil(n / cols) };
}

// Doubling bin edges starting at 1: [1, 2, 3, 5, 9, 17, …] — bins are [edge[i], edge[i+1]).
// The last edge is always > max, so every value 1…max lands in a bin.
export function log2Edges(max) {
  const edges = [1, 2];
  while (edges[edges.length - 1] <= max) {
    const last = edges[edges.length - 1];
    edges.push(last + (last - edges[edges.length - 2]) * (edges.length > 2 ? 2 : 1));
  }
  return edges;
}

export function binLabel(lo, hiExclusive) {
  return hiExclusive - lo === 1 ? String(lo) : `${lo}–${hiExclusive - 1}`;
}

// Count values into bins defined by ascending edges. Values outside [edges[0], last) are ignored.
export function histogram(values, edges) {
  const counts = new Array(edges.length - 1).fill(0);
  for (const v of values) {
    if (v < edges[0] || v >= edges[edges.length - 1]) continue;
    let i = 0;
    while (v >= edges[i + 1]) i++;
    counts[i]++;
  }
  return counts;
}

export function linearScale([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

// "Nice" tick values from 0 up to at least max, about `count` of them.
export function niceTicks(max, count = 5) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v < max + step * 0.5; v += step) ticks.push(+v.toPrecision(12));
  if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toPrecision(12));
  return ticks;
}

export const pct = (part, whole) => (whole > 0 ? (100 * part) / whole : 0);
export const fmtPct = (v) => `${v.toFixed(v > 0 && v < 10 ? 1 : 0)}%`;
export const fmtInt = (v) => Math.round(v).toLocaleString('en-US');

export function personLabel(pop, id) {
  return `#${id} ${pop.role[id] === STAFF ? 'Teacher' : 'Student'}`;
}

// ---------- DOM helpers ----------

const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

const htmlEl = (tag, attrs = {}, text) => {
  const e = document.createElement(tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
};

function placeTooltip(tooltip, wrap, clientX, clientY, html) {
  const r = wrap.getBoundingClientRect();
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const half = tooltip.offsetWidth / 2;
  const x = Math.min(Math.max(clientX - r.left, half), r.width - half);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${clientY - r.top}px`;
}

function toViewBox(svg, vbW, vbH, clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { x: ((clientX - r.left) * vbW) / r.width, y: ((clientY - r.top) * vbH) / r.height };
}

const necklaceText = ({ blue, gold }) => `${blue} blue · ${gold} gold`;

// ---------- 1. Roshambo match view ----------

// The glyph sits in its own span so the grayscale filter doesn't touch the
// win highlight drawn on the outer box.
function handEl(move, cls) {
  const outer = htmlEl('span', { class: cls, title: move, role: 'img', 'aria-label': move });
  outer.append(htmlEl('span', { class: 'glyph', 'aria-hidden': 'true' }, moveGlyph(move)));
  return outer;
}

// match = { rounds, winner: 0|1, coinFlip }; labels = [nameA, nameB]
// detail (optional) = { before: [h, h], after: [h, h], moved } for necklace challenges.
export function renderMatch(container, match, { labels = ['Player A', 'Player B'], detail = null, animate = true } = {}) {
  container.textContent = '';
  const root = htmlEl('div', { class: `match${animate ? ' animate' : ''}` });

  const head = htmlEl('div', { class: 'match-head' });
  head.append(
    htmlEl('span', { class: `player${match.winner === 0 ? ' winner' : ''}` }, labels[0]),
    htmlEl('span', { class: 'vs' }, 'vs'),
    htmlEl('span', { class: `player right${match.winner === 1 ? ' winner' : ''}` }, labels[1]),
  );
  root.append(head);

  const list = htmlEl('ol', { class: 'rounds' });
  const rows = matchSummary(match.rounds);
  rows.forEach((r, i) => {
    const li = htmlEl('li', { class: `round${r.result === 0 ? ' tie' : ''}`, style: `--i:${i}` });
    const outcome = r.result > 0 ? 'beats' : r.result < 0 ? 'loses to' : 'ties';
    li.append(
      htmlEl('span', { class: 'round-n' }, `Round ${i + 1}`),
      handEl(r.a, `hand${r.result > 0 ? ' won' : ''}`),
      htmlEl('span', { class: 'outcome' }, r.result === 0 ? 'tie — replay' : outcome),
      handEl(r.b, `hand mirror${r.result < 0 ? ' won' : ''}`),
      htmlEl('span', { class: 'round-score' }, `${r.scoreA}–${r.scoreB}`),
    );
    list.append(li);
  });
  root.append(list);

  const last = rows[rows.length - 1] || { scoreA: 0, scoreB: 0 };
  const result = htmlEl('div', { class: 'match-result', style: `--i:${rows.length}` });
  const winnerName = labels[match.winner];
  result.append(htmlEl('strong', {}, `${winnerName} wins ${Math.max(last.scoreA, last.scoreB)}–${Math.min(last.scoreA, last.scoreB)}`));
  if (match.coinFlip) result.append(htmlEl('span', { class: 'muted' }, ' (too many ties — decided by coin flip)'));
  if (detail) {
    const { moved, before, after } = detail;
    const parts = [];
    if (moved.gold) parts.push(`${moved.gold} gold`);
    if (moved.blue) parts.push(`${moved.blue} blue`);
    result.append(htmlEl('div', { class: 'moved' },
      parts.length ? `takes ${parts.join(' + ')} necklace${moved.blue + moved.gold > 1 ? 's' : ''}` : 'but the loser had nothing to give'));
    const table = htmlEl('div', { class: 'before-after' });
    [0, 1].forEach((side) => {
      table.append(htmlEl('span', { class: 'ba-name' }, labels[side]),
        htmlEl('span', {}, necklaceText(before[side])),
        htmlEl('span', { class: 'arrow' }, '→'),
        htmlEl('span', {}, necklaceText(after[side])));
    });
    result.append(table);
  }
  root.append(result);
  container.append(root);
}

// ---------- 2. Population view ----------

const POP_W = 800, POP_MAX_H = 300;

// Mark sizes, as a fraction of the grid cell. Holding 1 necklace gives the smallest
// mark; holding every necklace in play gives the largest. MARK_MAX = 0.75 means a
// maximal mark is 1.5 cells across, so two maximal neighbours overlap by half a
// cell, which is 1/3 of a mark's width.
export const MARK_EMPTY = 0.16, MARK_MIN = 0.3, MARK_MAX = 0.75;

// Radius (in the same units as `cell`) for someone holding `n` of `maxN` necklaces.
// Log₂ scale: every doubling of necklaces adds the same amount of radius.
export function markRadius(n, maxN, cell) {
  if (n <= 0) return MARK_EMPTY * cell;
  const t = maxN > 1 ? Math.min(1, Math.log2(n) / Math.log2(maxN)) : 0;
  return (MARK_MIN + (MARK_MAX - MARK_MIN) * t) * cell;
}

// Width of the gold ring drawn over a blue disk, as a fraction of the cell.
export const RING_WIDTH = 0.14;

// Sizes for the size key: powers of ten up to maxN, plus maxN itself.
export function sizeKeyValues(maxN) {
  const vals = [];
  for (let v = 1; v < maxN; v *= 10) vals.push(v);
  if (maxN >= 1) vals.push(maxN);
  return vals;
}

// Draw a square (teachers) or circle (students) of "radius" r centred on 0,0.
function setShape(node, isSquare, r) {
  if (isSquare) {
    node.setAttribute('x', -r); node.setAttribute('y', -r);
    node.setAttribute('width', 2 * r); node.setAttribute('height', 2 * r);
    node.setAttribute('rx', r * 0.3);
  } else {
    node.setAttribute('r', r);
  }
}

// Every person is one mark: students are circles, teachers are squares.
// Each colour is sized by its own count on the same log scale: blue is a disk,
// gold is a ring drawn on top of it (or a solid disk if they hold no blue).
// Faded marks are out of the game.
export function createPopulationView({ svg, wrap, tooltip, onPick, sizeKey }) {
  let layout = null, groups = [], blues = [], golds = [], keys = [], current = null, maxN = 1;

  function build(pop) {
    svg.textContent = '';
    layout = gridLayout(pop.size, POP_W, POP_MAX_H);
    svg.setAttribute('viewBox', `0 0 ${POP_W} ${Math.max(layout.height, 1)}`);
    const { cols, cell } = layout;
    groups = new Array(pop.size);
    blues = new Array(pop.size);
    golds = new Array(pop.size);
    keys = new Array(pop.size).fill('');
    for (let id = 0; id < pop.size; id++) {
      const cx = (id % cols) * cell + cell / 2, cy = Math.floor(id / cols) * cell + cell / 2;
      const shape = pop.role[id] === STAFF ? 'rect' : 'circle';
      const g = svgEl('g', { transform: `translate(${cx},${cy})` }, svg);
      blues[id] = svgEl(shape, {}, g);
      golds[id] = svgEl(shape, {}, g);
      groups[id] = g;
    }
    // One scale for both colours, set by everything in play, so sizes are
    // comparable and don't jump as the leader changes.
    let total = 0;
    for (let id = 0; id < pop.size; id++) total += pop.blue[id] + pop.gold[id];
    maxN = Math.max(1, total);
    if (sizeKey) renderSizeKey(sizeKey, maxN);
  }

  function idAt(clientX, clientY) {
    if (!layout || !current) return -1;
    const { x, y } = toViewBox(svg, POP_W, layout.height, clientX, clientY);
    const col = Math.floor(x / layout.cell), row = Math.floor(y / layout.cell);
    if (col < 0 || col >= layout.cols || row < 0) return -1;
    const id = row * layout.cols + col;
    return id < current.pop.size ? id : -1;
  }

  svg.addEventListener('mousemove', (e) => {
    const id = idAt(e.clientX, e.clientY);
    if (id < 0) { tooltip.hidden = true; return; }
    const { pop, isActive } = current;
    placeTooltip(tooltip, wrap, e.clientX, e.clientY,
      `<strong>${personLabel(pop, id)}</strong><br>${necklaceText({ blue: pop.blue[id], gold: pop.gold[id] })}`
      + `<br><span class="muted">${pop.gamesPlayed[id]} games · ${isActive(id) ? 'still playing' : 'out'}</span>`);
  });
  svg.addEventListener('mouseleave', () => { tooltip.hidden = true; });
  if (onPick) svg.addEventListener('click', (e) => {
    const id = idAt(e.clientX, e.clientY);
    if (id >= 0) onPick(id, e);
  });

  return {
    // isActive: (id) => boolean
    update(pop, isActive) {
      if (!current || current.pop !== pop) build(pop);
      current = { pop, isActive };
      const { cell } = layout;
      const ringW = Math.max(1.2, RING_WIDTH * cell);
      let resized = false;
      for (let id = 0; id < pop.size; id++) {
        const b = pop.blue[id], g = pop.gold[id], active = isActive(id);
        const key = `${b},${g},${active}`;
        if (key === keys[id]) continue;
        keys[id] = key;
        const square = pop.role[id] === STAFF;
        const blue = blues[id], gold = golds[id];
        if (b > 0 || g === 0) {
          // Blue disk (or a small grey dot for someone holding nothing).
          blue.setAttribute('class', b > 0 ? 'disk p-blue' : 'disk p-none');
          setShape(blue, square, markRadius(b, maxN, cell));
          blue.removeAttribute('visibility');
        } else {
          blue.setAttribute('visibility', 'hidden');
        }
        if (g > 0) {
          const r = markRadius(g, maxN, cell);
          if (b > 0) {
            // Ring: its outer edge sits at r, so it's the same size a gold disk would be.
            gold.setAttribute('class', 'ring');
            gold.setAttribute('stroke-width', ringW);
            setShape(gold, square, Math.max(ringW / 2, r - ringW / 2));
          } else {
            gold.setAttribute('class', 'disk p-gold');
            gold.removeAttribute('stroke-width');
            setShape(gold, square, r);
          }
          gold.removeAttribute('visibility');
        } else {
          gold.setAttribute('visibility', 'hidden');
        }
        groups[id].setAttribute('class', active ? '' : 'out');
        resized = true;
      }
      // Draw bigger marks last so overlaps never hide a big holder.
      if (resized) {
        const size = (id) => Math.max(pop.blue[id], pop.gold[id]);
        const big = [];
        for (let id = 0; id < pop.size; id++) if (size(id) > 1) big.push(id);
        big.sort((a, b) => size(a) - size(b));
        for (const id of big) svg.appendChild(groups[id]);
      }
    },
  };
}

// A row of example marks: 1, 10, 100 … necklaces, at the grid's relative scale.
// Blue disks and gold rings share this scale.
function renderSizeKey(container, maxN) {
  const vals = sizeKeyValues(maxN);
  const cell = 22; // drawn larger than the grid so it's readable; proportions match
  const rMax = MARK_MAX * cell;
  const gap = 10;
  let x = 0;
  const items = vals.map((v) => {
    const item = { v, r: markRadius(v, maxN, cell), cx: x + rMax };
    x += 2 * rMax + gap + String(fmtInt(v)).length * 7;
    return item;
  });
  container.textContent = '';
  const svg = svgEl('svg', { viewBox: `0 0 ${x} ${2 * rMax + 2}`, width: x, height: 2 * rMax + 2, 'aria-hidden': 'true' }, container);
  for (const it of items) {
    svgEl('circle', { class: 'disk p-blue', cx: it.cx, cy: rMax + 1, r: it.r }, svg);
    svgEl('text', { x: it.cx + rMax + 3, y: rMax + 5 }, svg).textContent = fmtInt(it.v);
  }
}

// ---------- 3. Simulation view (charts) ----------

const VB_W = 800, VB_H = 360;
const M = { top: 24, right: 16, bottom: 56, left: 52 };
const PW = VB_W - M.left - M.right;
const PH = VB_H - M.top - M.bottom;
const BASE_Y = M.top + PH;

function drawYGrid(g, ticks, y, fmt) {
  for (const t of ticks) {
    const yy = y(t);
    svgEl('line', { x1: M.left, x2: M.left + PW, y1: yy, y2: yy }, g);
    svgEl('text', { x: M.left - 8, y: yy + 4, 'text-anchor': 'end' }, g).textContent = fmt(t);
  }
}

// People per bin of total necklaces held, split by role. People holding nothing
// are counted separately (they'd dwarf every other bar).
export function roleHistogram(pop) {
  let max = 1, emptyStudents = 0, emptyStaff = 0;
  const studentTotals = [], staffTotals = [];
  for (let id = 0; id < pop.size; id++) {
    const n = pop.blue[id] + pop.gold[id];
    if (n > max) max = n;
    const staff = pop.role[id] === STAFF;
    if (n === 0) { if (staff) emptyStaff++; else emptyStudents++; continue; }
    (staff ? staffTotals : studentTotals).push(n);
  }
  const edges = log2Edges(max);
  return {
    edges,
    students: histogram(studentTotals, edges),
    staff: histogram(staffTotals, edges),
    emptyStudents,
    emptyStaff,
  };
}

// Bar path: square bottom, 4px rounded top when `roundTop`.
function barPath(x, yTop, w, h, roundTop) {
  const r = roundTop ? Math.min(4, w / 2, h) : 0;
  return `M${x},${yTop + h}V${yTop + r}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}V${yTop + h}Z`;
}

const STACK_GAP = 2; // surface gap between stacked segments

// Stacked histogram: how many people hold 1, 2, 3–4, 5–8 … necklaces in total,
// students on the bottom and teachers stacked on top.
export function createHistogramView({ svg, wrap, tooltip, note }) {
  svg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`);
  let bars = [];

  svg.addEventListener('mousemove', (e) => {
    const { x, y } = toViewBox(svg, VB_W, VB_H, e.clientX, e.clientY);
    const hit = bars.find((b) => x >= b.x0 && x < b.x1 && y >= M.top && y <= BASE_Y);
    if (!hit) { tooltip.hidden = true; return; }
    placeTooltip(tooltip, wrap, e.clientX, e.clientY,
      `<strong>Holding ${hit.label} necklace${hit.label === '1' ? '' : 's'}</strong>`
      + `<br><span class="swatch student"></span> ${fmtInt(hit.students)} student${hit.students === 1 ? '' : 's'}`
      + `<br><span class="swatch staff"></span> ${fmtInt(hit.staff)} teacher${hit.staff === 1 ? '' : 's'}`
      + `<br><span class="muted">${fmtInt(hit.students + hit.staff)} people in all</span>`);
  });
  svg.addEventListener('mouseleave', () => { tooltip.hidden = true; });

  return {
    update(pop) {
      const { edges, students, staff, emptyStudents, emptyStaff } = roleHistogram(pop);
      const nb = edges.length - 1;
      const totals = students.map((v, i) => v + staff[i]);
      const ticks = niceTicks(Math.max(1, ...totals), 4);
      const y = linearScale([0, ticks[ticks.length - 1]], [BASE_Y, M.top]);
      const slot = PW / nb;
      const barW = Math.min(56, slot * 0.6);

      svg.textContent = '';
      drawYGrid(svgEl('g', { class: 'grid' }, svg), ticks, y, fmtInt);
      const gBars = svgEl('g', {}, svg);
      svgEl('line', { class: 'baseline', x1: M.left, x2: M.left + PW, y1: BASE_Y, y2: BASE_Y }, svg);
      const gX = svgEl('g', { class: 'xtick' }, svg);
      const gTotals = svgEl('g', { class: 'bar-total' }, svg);
      bars = [];
      for (let i = 0; i < nb; i++) {
        const cx = M.left + slot * (i + 0.5);
        const x = cx - barW / 2;
        const label = binLabel(edges[i], edges[i + 1]);
        const hS = students[i] > 0 ? Math.max(1.5, BASE_Y - y(students[i])) : 0;
        const hT = staff[i] > 0 ? Math.max(1.5, BASE_Y - y(staff[i])) : 0;
        if (hS) svgEl('path', { class: 'bar student', d: barPath(x, BASE_Y - hS, barW, hS, !hT) }, gBars);
        if (hT) {
          const base = hS ? BASE_Y - hS - STACK_GAP : BASE_Y;
          svgEl('path', { class: 'bar staff', d: barPath(x, base - hT, barW, hT, true) }, gBars);
        }
        if (totals[i] > 0) {
          const top = BASE_Y - hS - hT - (hS && hT ? STACK_GAP : 0);
          svgEl('text', { x: cx, y: top - 6, 'text-anchor': 'middle' }, gTotals).textContent = fmtInt(totals[i]);
        }
        svgEl('text', { x: cx, y: BASE_Y + 20, 'text-anchor': 'middle' }, gX).textContent = label;
        bars.push({ x0: cx - slot / 2, x1: cx + slot / 2, label, students: students[i], staff: staff[i] });
      }
      svgEl('text', { class: 'axis-title', x: M.left + PW / 2, y: VB_H - 8, 'text-anchor': 'middle' }, svg)
        .textContent = 'Necklaces held by one person (blue + gold)';
      if (note) note.textContent = `Not shown: ${fmtInt(emptyStudents + emptyStaff)} people hold no necklaces `
        + `(${fmtInt(emptyStudents)} students, ${fmtInt(emptyStaff)} teachers). `
        + 'Bins double in width so a few big winners don’t squash everyone else.';
    },
  };
}

// People per bin of necklaces of each colour. People holding none of a colour
// are counted separately (they'd dwarf every other bar).
export function colorHistogram(pop) {
  let max = 1, noBlue = 0, noGold = 0;
  for (let id = 0; id < pop.size; id++) {
    max = Math.max(max, pop.blue[id], pop.gold[id]);
    if (pop.blue[id] === 0) noBlue++;
    if (pop.gold[id] === 0) noGold++;
  }
  const edges = log2Edges(max);
  return { edges, blue: histogram(pop.blue, edges), gold: histogram(pop.gold, edges), noBlue, noGold };
}

// Grouped histogram: how many people hold 1, 2, 3–4 … blue necklaces, and how many
// hold that many gold, side by side in each bin.
export function createColorHistogramView({ svg, wrap, tooltip, note }) {
  svg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`);
  let bars = [];

  svg.addEventListener('mousemove', (e) => {
    const { x, y } = toViewBox(svg, VB_W, VB_H, e.clientX, e.clientY);
    const hit = bars.find((b) => x >= b.x0 && x < b.x1 && y >= M.top && y <= BASE_Y);
    if (!hit) { tooltip.hidden = true; return; }
    placeTooltip(tooltip, wrap, e.clientX, e.clientY,
      `<strong>Holding ${hit.label}</strong>`
      + `<br><span class="swatch blue"></span> ${fmtInt(hit.blue)} people hold this many blue`
      + `<br><span class="swatch gold"></span> ${fmtInt(hit.gold)} people hold this many gold`);
  });
  svg.addEventListener('mouseleave', () => { tooltip.hidden = true; });

  return {
    update(pop) {
      const { edges, blue, gold, noBlue, noGold } = colorHistogram(pop);
      const ticks = niceTicks(Math.max(1, ...blue, ...gold), 4);
      const y = linearScale([0, ticks[ticks.length - 1]], [BASE_Y, M.top]);
      const nb = edges.length - 1;
      const slot = PW / nb;
      const barW = Math.min(36, (slot - 12) / 2);

      svg.textContent = '';
      drawYGrid(svgEl('g', { class: 'grid' }, svg), ticks, y, fmtInt);
      const gBars = svgEl('g', {}, svg);
      svgEl('line', { class: 'baseline', x1: M.left, x2: M.left + PW, y1: BASE_Y, y2: BASE_Y }, svg);
      const gX = svgEl('g', { class: 'xtick' }, svg);
      bars = [];
      for (let i = 0; i < nb; i++) {
        const cx = M.left + slot * (i + 0.5);
        const label = binLabel(edges[i], edges[i + 1]);
        // Bars sit side by side with a 2px surface gap between them.
        [['blue', blue[i], cx - barW - STACK_GAP / 2], ['gold', gold[i], cx + STACK_GAP / 2]].forEach(([cls, v, x]) => {
          if (v <= 0) return;
          const h = Math.max(1.5, BASE_Y - y(v));
          svgEl('path', { class: `bar ${cls}`, d: barPath(x, BASE_Y - h, barW, h, true) }, gBars);
        });
        svgEl('text', { x: cx, y: BASE_Y + 20, 'text-anchor': 'middle' }, gX).textContent = label;
        bars.push({ x0: cx - slot / 2, x1: cx + slot / 2, label, blue: blue[i], gold: gold[i] });
      }
      svgEl('text', { class: 'axis-title', x: M.left + PW / 2, y: VB_H - 8, 'text-anchor': 'middle' }, svg)
        .textContent = 'Necklaces of one colour held by one person';
      if (note) note.textContent = `Not shown: ${fmtInt(noBlue)} people hold no blue necklaces and ${fmtInt(noGold)} hold no gold. `
        + 'Someone holding both colours is counted once in blue and once in gold.';
    },
  };
}

// Line chart over time. All three series are percentages, so they share one 0–100% axis.
export const TREND_SERIES = [
  { key: 'goldWithStudents', cls: 'gold', label: 'Gold necklaces held by students',
    value: (h) => pct(h.studentGold, h.gold) },
  { key: 'blueWithStaff', cls: 'blue', label: 'Blue necklaces held by teachers',
    value: (h) => pct(h.staffBlue, h.blue) },
  { key: 'empty', cls: 'neutral', label: 'People with no necklaces',
    value: (h) => pct(h.empty, h.active + h.out) },
];

export function createTrendView({ svg, wrap, tooltip }) {
  svg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`);
  let state = null;

  svg.addEventListener('mousemove', (e) => {
    if (!state || state.history.length < 2) return;
    const { x } = toViewBox(svg, VB_W, VB_H, e.clientX, e.clientY);
    const { history, xs, cross } = state;
    const tick = Math.round(xs.invert(x));
    const h = history[Math.min(Math.max(tick, 0), history.length - 1)];
    const cx = xs(h.tick);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.removeAttribute('visibility');
    placeTooltip(tooltip, wrap, e.clientX, e.clientY,
      `<strong>Tick ${h.tick}</strong> <span class="muted">(${fmtClock(h.tick)})</span>`
      + TREND_SERIES.map((s) => `<br><span class="swatch ${s.cls}"></span> ${s.label}: <strong>${fmtPct(s.value(h))}</strong>`).join(''));
  });
  svg.addEventListener('mouseleave', () => {
    tooltip.hidden = true;
    state?.cross.setAttribute('visibility', 'hidden');
  });

  return {
    update(history, maxTicks) {
      svg.textContent = '';
      const xMax = Math.max(1, maxTicks);
      const xs = linearScale([0, xMax], [M.left, M.left + PW]);
      xs.invert = linearScale([M.left, M.left + PW], [0, xMax]);
      const y = linearScale([0, 100], [BASE_Y, M.top]);

      drawYGrid(svgEl('g', { class: 'grid' }, svg), [0, 25, 50, 75, 100], y, (t) => `${t}%`);
      svgEl('line', { class: 'baseline', x1: M.left, x2: M.left + PW, y1: BASE_Y, y2: BASE_Y }, svg);
      const gX = svgEl('g', { class: 'xtick' }, svg);
      for (const t of niceTicks(xMax, 6).filter((t) => t <= xMax)) {
        svgEl('text', { x: xs(t), y: BASE_Y + 20, 'text-anchor': 'middle' }, gX).textContent = String(t);
      }
      svgEl('text', { class: 'axis-title', x: M.left + PW / 2, y: VB_H - 8, 'text-anchor': 'middle' }, svg)
        .textContent = 'Tick (one 5-second game slot)';

      const cross = svgEl('line', { class: 'crosshair', y1: M.top, y2: BASE_Y, visibility: 'hidden' }, svg);
      for (const s of TREND_SERIES) {
        const d = history.map((h, i) => `${i ? 'L' : 'M'}${xs(h.tick).toFixed(1)},${y(s.value(h)).toFixed(1)}`).join('');
        svgEl('path', { class: `trend ${s.cls}`, d }, svg);
        const lastH = history[history.length - 1];
        if (lastH) svgEl('circle', { class: `trend-end ${s.cls}`, cx: xs(lastH.tick), cy: y(s.value(lastH)), r: 4 }, svg);
      }
      state = { history, xs, cross };
    },
  };
}

// Tick → "m:ss" of passing time at 5 s per game.
export function fmtClock(tick, secondsPerTick = 5) {
  const s = tick * secondsPerTick;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
