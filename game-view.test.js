import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moveGlyph, matchSummary, classifyHolder, gridLayout, log2Edges, binLabel, histogram,
  linearScale, niceTicks, pct, fmtPct, fmtClock, personLabel, TREND_SERIES,
  markRadius, sizeKeyValues, roleHistogram, colorHistogram, MARK_EMPTY, MARK_MIN, MARK_MAX,
} from './game-view.js';
import { MOVES, STAFF, STUDENT } from './game.js';

test('moveGlyph maps every move to a hand', () => {
  assert.deepEqual(MOVES.map(moveGlyph), ['✊', '✋', '✌️']);
  assert.equal(moveGlyph('lizard'), '?');
});

test('matchSummary keeps a running score, ties unchanged', () => {
  const rows = matchSummary([
    { a: 'rock', b: 'rock', result: 0 },
    { a: 'rock', b: 'paper', result: -1 },
    { a: 'rock', b: 'scissors', result: 1 },
    { a: 'paper', b: 'rock', result: 1 },
  ]);
  assert.deepEqual(rows.map((r) => [r.scoreA, r.scoreB]), [[0, 0], [0, 1], [1, 1], [2, 1]]);
});

test('classifyHolder', () => {
  assert.equal(classifyHolder(0, 0), 'none');
  assert.equal(classifyHolder(2, 0), 'blue');
  assert.equal(classifyHolder(0, 1), 'gold');
  assert.equal(classifyHolder(1, 1), 'both');
});

test('gridLayout fits everyone inside the box with the biggest cell', () => {
  const l = gridLayout(1750, 800, 300);
  assert.ok(l.cols * l.rows >= 1750);
  assert.ok(l.height <= 300);
  assert.ok(l.cols * l.cell <= 800);
  const bigger = l.cell + 1;
  assert.ok(Math.ceil(1750 / Math.floor(800 / bigger)) * bigger > 300, 'next size up would not fit');
  assert.equal(gridLayout(4, 800, 300).cell, 24, 'small groups cap at maxCell');
});

test('log2Edges covers 1…max with doubling bins', () => {
  assert.deepEqual(log2Edges(1), [1, 2]);
  assert.deepEqual(log2Edges(4), [1, 2, 3, 5]);
  assert.deepEqual(log2Edges(16), [1, 2, 3, 5, 9, 17]);
  for (const max of [1, 2, 7, 100, 1750]) {
    const e = log2Edges(max);
    assert.ok(e[e.length - 1] > max);
    assert.ok(e[e.length - 2] <= max, 'no empty trailing bin');
  }
  assert.equal(binLabel(1, 2), '1');
  assert.equal(binLabel(5, 9), '5–8');
});

test('histogram counts into bins and ignores out-of-range values', () => {
  const edges = [1, 2, 3, 5];
  assert.deepEqual(histogram([0, 1, 1, 2, 3, 4, 5, 99], edges), [2, 1, 2]);
  assert.deepEqual(histogram(Int32Array.from([1, 4]), edges), [1, 0, 1]);
});

test('linearScale and niceTicks', () => {
  const s = linearScale([0, 10], [100, 0]);
  assert.equal(s(0), 100); assert.equal(s(5), 50); assert.equal(s(10), 0);
  assert.deepEqual(niceTicks(100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(7, 4), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(0), [0, 1]);
  const t = niceTicks(1600, 4);
  assert.ok(t[t.length - 1] >= 1600);
});

test('formatting helpers', () => {
  assert.equal(pct(1, 4), 25);
  assert.equal(pct(1, 0), 0);
  assert.equal(fmtPct(25), '25%');
  assert.equal(fmtPct(2.345), '2.3%');
  assert.equal(fmtPct(0), '0%');
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(300), '25:00');
  assert.equal(fmtClock(13), '1:05');
  const pop = { role: Uint8Array.from([STUDENT, STAFF]) };
  assert.equal(personLabel(pop, 0), '#0 Student');
  assert.equal(personLabel(pop, 1), '#1 Teacher');
});

test('trend series are percentages of the right totals', () => {
  const h = { gold: 150, studentGold: 30, blue: 1600, staffBlue: 160, empty: 175, active: 1500, out: 250 };
  assert.deepEqual(TREND_SERIES.map((s) => s.value(h)), [20, 10, 10]);
});

test('markRadius: log scale from 1 necklace to everything in play', () => {
  const cell = 10, maxN = 1750;
  assert.equal(markRadius(0, maxN, cell), MARK_EMPTY * cell);
  assert.equal(markRadius(1, maxN, cell), MARK_MIN * cell);
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(close(markRadius(maxN, maxN, cell), MARK_MAX * cell));
  assert.ok(close(markRadius(5000, maxN, cell), MARK_MAX * cell), 'clamped');
  // every doubling adds the same radius
  const d1 = markRadius(4, maxN, cell) - markRadius(2, maxN, cell);
  const d2 = markRadius(64, maxN, cell) - markRadius(32, maxN, cell);
  assert.ok(Math.abs(d1 - d2) < 1e-9);
  let prev = -1;
  for (let n = 0; n <= maxN; n++) { const r = markRadius(n, maxN, cell); assert.ok(r >= prev); prev = r; }
  assert.equal(markRadius(1, 1, cell), MARK_MIN * cell, 'single necklace in play');
});

test('markRadius: two maximal neighbours overlap by at most 1/3 of a mark', () => {
  const cell = 11;
  const d = 2 * markRadius(100, 100, cell);
  const overlap = d - cell; // centres are one cell apart
  assert.ok(overlap <= d / 3 + 1e-9, `overlap ${overlap} of ${d}`);
});

test('sizeKeyValues: powers of ten then the max', () => {
  assert.deepEqual(sizeKeyValues(1750), [1, 10, 100, 1000, 1750]);
  assert.deepEqual(sizeKeyValues(100), [1, 10, 100]);
  assert.deepEqual(sizeKeyValues(1), [1]);
});

test('roleHistogram: people per total-necklace bin, split by role; empties counted apart', () => {
  // ids 0–3 students, 4–5 teachers
  const pop = {
    size: 6,
    role: Uint8Array.from([STUDENT, STUDENT, STUDENT, STUDENT, STAFF, STAFF]),
    blue: Int32Array.from([0, 1, 2, 3, 0, 4]),
    gold: Int32Array.from([0, 0, 1, 1, 0, 1]),
  };
  // totals: students 0, 1, 3, 4 · teachers 0, 5
  const h = roleHistogram(pop);
  assert.deepEqual(h.edges, [1, 2, 3, 5, 9]);
  assert.deepEqual(h.students, [1, 0, 2, 0]);
  assert.deepEqual(h.staff, [0, 0, 0, 1]);
  assert.equal(h.emptyStudents, 1);
  assert.equal(h.emptyStaff, 1);
});

test('colorHistogram: people per bin of each colour; people without a colour counted apart', () => {
  const pop = {
    size: 4,
    blue: Int32Array.from([0, 1, 3, 4]),
    gold: Int32Array.from([1, 0, 0, 2]),
  };
  const h = colorHistogram(pop);
  assert.deepEqual(h.edges, [1, 2, 3, 5]);
  assert.deepEqual(h.blue, [1, 0, 2]);
  assert.deepEqual(h.gold, [1, 1, 0]);
  assert.equal(h.noBlue, 1);
  assert.equal(h.noGold, 2);
});
