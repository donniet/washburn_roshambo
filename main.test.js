import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, endMessage } from './main.js';
import { createSimulation } from './strategies.js';
import { DEFAULT_RULES, DEFAULT_POPULATION } from './game.js';

test('readConfig: empty form gives the defaults', () => {
  const c = readConfig({});
  assert.deepEqual(c.cfg, DEFAULT_POPULATION);
  assert.deepEqual(c.rules, DEFAULT_RULES);
  assert.equal(c.strategyId, 'classroom');
  assert.deepEqual(c.params, { challengeBy: 'random', declineBy: 'never', groupSize: 30 });
  assert.equal(c.seed, 'washburn');
});

test('readConfig: reads form strings', () => {
  const c = readConfig({
    numStudents: '500', numStaff: '40', numBlue: '250', numGold: '40', maxGamesPerPerson: '60',
    transfer: 'all', staffVsStudent: 'never', staffVsStaff: 'never', zeroNecklaces: 'canChallenge', declining: 'ifFewer',
    strategyId: 'random', 'param:participation': '0.5', 'param:declineRate': '0.25', seed: '1234',
  });
  assert.deepEqual(c.cfg, { numStudents: 500, numStaff: 40, numBlue: 250, numGold: 40 });
  assert.deepEqual(c.rules, {
    transfer: 'all', staffVsStudent: 'never', staffVsStaff: 'never', zeroNecklaces: 'canChallenge', declining: 'ifFewer', maxGamesPerPerson: 60,
  });
  assert.equal(c.params.participation, 0.5);
  assert.equal(c.params.declineRate, 0.25);
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
  assert.equal(c.strategyId, 'classroom');
  assert.equal(c.params.groupSize, 30);
  assert.equal(c.seed, 'monday');
});

test('readConfig: an empty school still has one person', () => {
  const c = readConfig({ numStudents: '0', numStaff: '0' });
  assert.equal(c.cfg.numStudents + c.cfg.numStaff, 1);
});

test('readConfig: classroom strategy options', () => {
  const c = readConfig({ strategyId: 'classroom', 'param:challengeBy': 'highest', 'param:declineBy': 'ifLess', 'param:groupSize': '12' });
  assert.deepEqual(c.params, { challengeBy: 'highest', declineBy: 'ifLess', groupSize: 12 });
  const bad = readConfig({ strategyId: 'classroom', 'param:challengeBy': 'sneaky', 'param:groupSize': '0' });
  assert.equal(bad.params.challengeBy, 'random');
  assert.equal(bad.params.groupSize, 1);
});

test('endMessage explains why a run finished', () => {
  const cfg = { numStudents: 60, numStaff: 5, numBlue: 60, numGold: 5 };
  const one = createSimulation({ cfg, rules: { transfer: 'all', zeroNecklaces: 'out', maxGamesPerPerson: 5000 }, seed: 1 }).run();
  const msg = endMessage(one);
  assert.match(msg, /holds all 65 necklaces and everyone else is out/);
  assert.match(msg, /CAN still challenge/);
  const time = createSimulation({ cfg, rules: { maxGamesPerPerson: 3 }, seed: 1 }).run();
  assert.equal(endMessage(time), 'Finished: everyone used their 3 time slots.');
});
