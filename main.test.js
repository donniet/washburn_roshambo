import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from './main.js';
import { DEFAULT_RULES, DEFAULT_POPULATION } from './game.js';

test('readConfig: empty form gives the defaults', () => {
  const c = readConfig({});
  assert.deepEqual(c.cfg, DEFAULT_POPULATION);
  assert.deepEqual(c.rules, DEFAULT_RULES);
  assert.equal(c.strategyId, 'random');
  assert.deepEqual(c.params, { participation: 1 });
  assert.equal(c.seed, 'washburn');
});

test('readConfig: reads form strings', () => {
  const c = readConfig({
    numStudents: '500', numStaff: '40', numBlue: '250', numGold: '40', maxGamesPerPerson: '60',
    transfer: 'all', staffVsStudent: 'never', zeroNecklaces: 'canChallenge',
    strategyId: 'random', 'param:participation': '0.5', seed: '1234',
  });
  assert.deepEqual(c.cfg, { numStudents: 500, numStaff: 40, numBlue: 250, numGold: 40 });
  assert.deepEqual(c.rules, { transfer: 'all', staffVsStudent: 'never', zeroNecklaces: 'canChallenge', maxGamesPerPerson: 60 });
  assert.equal(c.params.participation, 0.5);
  assert.equal(c.seed, 1234);
});

test('readConfig: clamps and rejects bad input', () => {
  const c = readConfig({
    numStudents: '-5', numStaff: '99999', numBlue: 'lots', numGold: '', maxGamesPerPerson: '0',
    transfer: 'everything', strategyId: 'unknown', 'param:participation': '7', seed: '  monday  ',
  });
  assert.equal(c.cfg.numStudents, 0);
  assert.equal(c.cfg.numStaff, 2000);
  assert.equal(c.cfg.numBlue, DEFAULT_POPULATION.numBlue);
  assert.equal(c.cfg.numGold, DEFAULT_POPULATION.numGold);
  assert.equal(c.rules.maxGamesPerPerson, 1);
  assert.equal(c.rules.transfer, DEFAULT_RULES.transfer);
  assert.equal(c.strategyId, 'random');
  assert.equal(c.params.participation, 1);
  assert.equal(c.seed, 'monday');
});

test('readConfig: an empty school still has one person', () => {
  const c = readConfig({ numStudents: '0', numStaff: '0' });
  assert.equal(c.cfg.numStudents + c.cfg.numStaff, 1);
});
