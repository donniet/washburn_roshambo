import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moveGlyph, matchSummary, classifyHolder, gridLayout, log2Edges, binLabel, histogram,
  linearScale, niceTicks, pct, fmtPct, fmtClock, personLabel, TREND_SERIES,
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
