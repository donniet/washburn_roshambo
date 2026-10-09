import test from 'node:test';
import assert from 'node:assert/strict';
import { STAFF, STUDENT, totals, canChallenge } from './game.js';
import {
  createSimulation, registerStrategy, listStrategies, getStrategy, defaultParams,
  sampleGroup, CHALLENGE_PICKERS, DECLINE_CHOICES, DEFAULT_STRATEGY,
} from './strategies.js';
import { createRng, createGameState, isActive, canDecline, necklaceCount } from './game.js';

const SMALL = { numStudents: 120, numStaff: 20, numBlue: 120, numGold: 20 };

const RULE_SETS = [];
for (const transfer of ['all', 'oneRandom', 'goldFirst', 'blueFirst'])
  for (const staffVsStudent of ['allowed', 'studentsMayChallengeStaff', 'never'])
    for (const zeroNecklaces of ['out', 'canChallenge'])
      for (const declining of ['never', 'ifFewer'])
        RULE_SETS.push({ transfer, staffVsStudent, zeroNecklaces, declining, maxGamesPerPerson: 40 });
RULE_SETS.push({ transfer: 'oneRandom', staffVsStaff: 'never', declining: 'always', maxGamesPerPerson: 40 });
RULE_SETS.push({ transfer: 'all', declining: 'ifMore', maxGamesPerPerson: 40 });

test('registry: random strategy is built in', () => {
  const def = getStrategy('random');
  assert.equal(def.name, 'Pairs are randomly chosen');
  assert.deepEqual(defaultParams(def), { participation: 1, declineRate: 0.5 });
  assert.throws(() => getStrategy('nope'));
});

test('registry: new strategies show up and duplicate ids are refused', () => {
  registerStrategy({ id: 'test-noop', name: 'No-op', create: () => ({ selectPairs: () => [] }) });
  assert.ok(listStrategies().some((s) => s.id === 'test-noop'));
  assert.throws(() => registerStrategy({ id: 'test-noop', name: 'again', create: () => ({}) }));
});

test('random strategy: pairs are disjoint and legal under every rule set', () => {
  for (const rules of RULE_SETS) {
    const sim = createSimulation({ cfg: SMALL, rules, seed: JSON.stringify(rules) });
    const inst = getStrategy('random').create({ participation: 1 });
    const { pop } = sim.state;
    for (let t = 0; t < 15 && !sim.done; t++) {
      const ctx = {
        pop, rules: sim.state.rules, rng: sim.state.rng, tick: t,
        isActive: () => true, // canChallenge below does the real check
        canChallenge: (a, b) => canChallenge(pop, a, b, sim.state.rules),
      };
      const pairs = inst.selectPairs(ctx);
      const seen = new Set();
      for (const [a, b] of pairs) {
        assert.ok(!seen.has(a) && !seen.has(b), 'disjoint');
        seen.add(a); seen.add(b);
        assert.ok(canChallenge(pop, a, b, sim.state.rules), `legal under ${JSON.stringify(rules)}`);
        if (rules.staffVsStudent === 'never') assert.equal(pop.role[a], pop.role[b]);
        if (rules.staffVsStudent === 'studentsMayChallengeStaff') {
          assert.ok(!(pop.role[a] === STAFF && pop.role[b] === STUDENT));
        }
      }
      sim.step();
    }
  }
});

test('random strategy: with full participation most active people get a game', () => {
  const sim = createSimulation({ cfg: SMALL, strategyId: 'random', seed: 1 });
  const events = sim.step();
  assert.ok(events.length >= 60, `only ${events.length} games among 140 people`);
  assert.equal(sim.history[1].rejected, 0);
});

test('random strategy: participation lowers the number of games', () => {
  const full = createSimulation({ cfg: SMALL, strategyId: 'random', seed: 2 }).step().length;
  const some = createSimulation({ cfg: SMALL, strategyId: 'random', seed: 2, params: { participation: 0.2 } }).step().length;
  assert.ok(some < full / 2, `${some} vs ${full}`);
});

test('scheduler: bad pairs from a strategy are dropped, not played', () => {
  registerStrategy({
    id: 'test-bad',
    name: 'Bad',
    create: () => ({
      selectPairs: () => [[0, 1], [1, 2], [3, 3], [-1, 4], [5, 'x'], [6, 130], null, [7, 8]],
    }),
  });
  // id 130 is staff; staff never play students here
  const sim = createSimulation({ cfg: SMALL, rules: { staffVsStudent: 'never' }, strategyId: 'test-bad', seed: 3 });
  const events = sim.step();
  assert.deepEqual(events.map((e) => [e.challenger, e.target]), [[0, 1], [7, 8]]);
  assert.equal(sim.history[1].rejected, 6);
  assert.equal(sim.state.pop.gamesPlayed[2], 0);
});

test('scheduler: moveChooser from a strategy is used', () => {
  registerStrategy({
    id: 'test-rock',
    name: 'Rocks vs scissors',
    create: () => ({
      selectPairs: () => [[0, 1]],
      moveChooser: (rng, history, id, side) => (side === 0 ? 'rock' : 'scissors'),
    }),
  });
  const sim = createSimulation({ cfg: SMALL, strategyId: 'test-rock', seed: 4 });
  const [ev] = sim.step();
  assert.equal(ev.winner, 0);
  assert.deepEqual(ev.rounds.map((r) => [r.a, r.b]), [['rock', 'scissors'], ['rock', 'scissors']]);
});

test('scheduler: totals conserved and games-per-person respected over full runs', () => {
  for (const rules of RULE_SETS) {
    const sim = createSimulation({ cfg: SMALL, rules, seed: 5 });
    const before = totals(sim.state.pop);
    sim.run();
    assert.ok(sim.done);
    assert.ok(sim.tick <= rules.maxGamesPerPerson);
    const after = totals(sim.state.pop);
    assert.equal(after.blue, before.blue);
    assert.equal(after.gold, before.gold);
    assert.ok(Math.max(...sim.state.pop.gamesPlayed) <= rules.maxGamesPerPerson);
    assert.equal(sim.history.length, sim.tick + 1);
  }
});

test('scheduler: under "out", winner-takes-all ends early with a single holder', () => {
  const sim = createSimulation({
    cfg: SMALL,
    rules: { transfer: 'all', zeroNecklaces: 'out', staffVsStudent: 'allowed', maxGamesPerPerson: 5000 },
    seed: 6,
  });
  sim.run();
  assert.ok(sim.tick < 5000, 'finished early');
  const holders = [...sim.state.pop.blue].filter((b, id) => b + sim.state.pop.gold[id] > 0).length;
  assert.equal(holders, 1);
});

test('scheduler: the same seed gives an identical history', () => {
  const opts = { cfg: SMALL, rules: { transfer: 'oneRandom', maxGamesPerPerson: 30 }, seed: 'repeat' };
  const a = createSimulation(opts).run().history;
  const b = createSimulation(opts).run().history;
  assert.deepEqual(a, b);
  const c = createSimulation({ ...opts, seed: 'other' }).run().history;
  assert.notDeepEqual(a, c);
});

test('scheduler: maxGamesPerPerson bounds the number of ticks', () => {
  const sim = createSimulation({ cfg: SMALL, rules: { zeroNecklaces: 'canChallenge', maxGamesPerPerson: 12 }, seed: 7 });
  sim.run();
  assert.equal(sim.tick, 12);
  assert.equal(sim.step(), null, 'no steps after done');
});

test('scheduler: declines are counted, legal, and use slots without moving necklaces', () => {
  const sim = createSimulation({
    cfg: SMALL, rules: { declining: 'always', maxGamesPerPerson: 30 }, strategyId: 'random', params: { declineRate: 0.5 }, seed: 8,
  });
  const before = totals(sim.state.pop);
  let declined = 0, played = 0;
  while (!sim.done) {
    const { pop } = sim.state;
    const evs = sim.step();
    for (const e of evs) {
      if (e.outcome === 'declined') {
        declined++;
        assert.equal(pop.role[e.target], STUDENT, 'only students decline');
        assert.deepEqual(e.before, e.after, 'nothing moves on a decline');
      } else played++;
    }
    const h = sim.history[sim.history.length - 1];
    assert.equal(h.declined + h.games, evs.length);
  }
  assert.ok(declined > 0 && played > 0, `${declined} declined, ${played} played`);
  const after = totals(sim.state.pop);
  assert.equal(after.blue, before.blue);
  assert.equal(after.gold, before.gold);
  const { pop } = sim.state;
  let slots = 0, games = 0, d = 0, da = 0;
  for (let id = 0; id < pop.size; id++) {
    slots += pop.slotsUsed[id]; games += pop.gamesPlayed[id]; d += pop.declines[id]; da += pop.declinedAgainst[id];
  }
  assert.equal(d, declined);
  assert.equal(da, declined);
  assert.equal(slots, 2 * (played + declined));
  assert.equal(games, 2 * played);
});

test('scheduler: declineRate 0 never declines; teachers never decline', () => {
  const none = createSimulation({ cfg: SMALL, rules: { declining: 'always', maxGamesPerPerson: 10 }, strategyId: 'random', params: { declineRate: 0 }, seed: 9 }).run();
  assert.equal(none.history.reduce((a, h) => a + h.declined, 0), 0);
  const all = createSimulation({ cfg: SMALL, rules: { declining: 'always', maxGamesPerPerson: 10 }, strategyId: 'random', params: { declineRate: 1 }, seed: 9 }).run();
  const { pop } = all.state;
  for (let id = 0; id < pop.size; id++) if (pop.role[id] === STAFF) assert.equal(pop.declines[id], 0);
  // with everyone declining, only challenges against teachers get played
  assert.ok(all.history.reduce((a, h) => a + h.declined, 0) > 0);
});

test('scheduler: strategy respond is only asked when declining is possible', () => {
  let asked = 0;
  registerStrategy({
    id: 'test-respond',
    name: 'Counts respond calls',
    create: () => ({
      selectPairs: () => [[0, 1], [2, 125]], // student→student, student→teacher
      respond: (ctx, c, t) => { asked++; assert.ok(ctx.canDecline(c, t)); return 'decline'; },
    }),
  });
  const sim = createSimulation({ cfg: SMALL, rules: { declining: 'always' }, strategyId: 'test-respond', seed: 10 });
  const evs = sim.step();
  assert.equal(asked, 1);
  assert.deepEqual(evs.map((e) => e.outcome), ['declined', 'played']);
  const off = createSimulation({ cfg: SMALL, rules: { declining: 'never' }, strategyId: 'test-respond', seed: 10 });
  assert.deepEqual(off.step().map((e) => e.outcome), ['played', 'played']);
  assert.equal(asked, 1);
});

// ---------- classroom strategy ----------

const CHALLENGE_OPTIONS = ['random', 'highest', 'lowest'];
const DECLINE_OPTIONS = ['never', 'ifMore', 'ifLess', 'coin'];

function ctxFor(state) {
  const { pop, rules, rng } = state;
  return {
    pop, rules, rng, tick: 1,
    isActive: (id) => isActive(pop, id, rules),
    canChallenge: (a, b) => canChallenge(pop, a, b, rules),
    canDecline: (a, b) => canDecline(pop, a, b, rules),
  };
}

test('classroom: is the default strategy with the expected options', () => {
  assert.equal(DEFAULT_STRATEGY, 'classroom');
  assert.equal(listStrategies()[0].id, 'classroom');
  const def = getStrategy('classroom');
  assert.deepEqual(defaultParams(def), { challengeBy: 'random', declineBy: 'never', groupSize: 30 });
  assert.deepEqual(def.params[0].options.map((o) => o.value), CHALLENGE_OPTIONS);
  assert.deepEqual(def.params[1].options.map((o) => o.value), DECLINE_OPTIONS);
});

test('sampleGroup: k distinct ids, never the excluded one', () => {
  const rng = createRng(1);
  for (const [n, k] of [[1750, 30], [10, 30], [10, 6], [40, 39], [1, 5]]) {
    const g = sampleGroup(rng, n, k, 3 % n);
    assert.equal(g.length, Math.min(k, n - 1));
    assert.equal(new Set(g).size, g.length);
    assert.ok(!g.includes(3 % n));
    assert.ok(g.every((id) => id >= 0 && id < n));
  }
});

test('classroom: pairs are disjoint and legal for every option and rule set', () => {
  for (const challengeBy of CHALLENGE_OPTIONS) {
    for (const rules of RULE_SETS.filter((_, i) => i % 3 === 0)) {
      const sim = createSimulation({ cfg: SMALL, rules, params: { challengeBy, declineBy: 'coin' }, seed: challengeBy + JSON.stringify(rules) });
      for (let t = 0; t < 8 && !sim.done; t++) {
        const pairs = sim.strategy.create({ challengeBy }).selectPairs(ctxFor(sim.state));
        const seen = new Set();
        for (const [a, b] of pairs) {
          assert.ok(!seen.has(a) && !seen.has(b));
          seen.add(a); seen.add(b);
          assert.ok(canChallenge(sim.state.pop, a, b, sim.state.rules));
        }
        sim.step();
        assert.equal(sim.history[sim.history.length - 1].rejected, 0, 'scheduler rejected nothing');
      }
    }
  }
});

test('classroom: highest / lowest pick the best target in the group', () => {
  const score = (id) => [5, 0, 9, 2, 9, 1][id];
  assert.equal(CHALLENGE_PICKERS.highest([0, 2, 3, 4], score), 2, 'first of the tied highest');
  assert.equal(CHALLENGE_PICKERS.lowest([0, 2, 3, 5], score), 5);
  assert.equal(CHALLENGE_PICKERS.random([3, 0, 2], score), 3);
});

test('classroom: with the whole school as the group, the first challenger takes the extreme target', () => {
  for (const [challengeBy, want] of [['highest', Math.max], ['lowest', Math.min]]) {
    const state = createGameState({ cfg: { numStudents: 60, numStaff: 0, numBlue: 200 }, seed: challengeBy });
    const ctx = ctxFor(state);
    const [[a, b]] = getStrategy('classroom').create({ challengeBy, groupSize: 1000 }).selectPairs(ctx);
    const others = [];
    for (let id = 0; id < state.pop.size; id++) if (id !== a && ctx.canChallenge(a, id)) others.push(necklaceCount(state.pop, id));
    assert.equal(necklaceCount(state.pop, b), want(...others), challengeBy);
  }
});

test('classroom: smaller groups leave more people without a partner', () => {
  const rules = { staffVsStudent: 'never', staffVsStaff: 'never' };
  const games = (groupSize) => createSimulation({ cfg: SMALL, rules, params: { groupSize }, seed: 11 }).step().length;
  assert.ok(games(1) < games(30), `${games(1)} vs ${games(30)}`);
});

test('classroom: decline options', () => {
  const rng = createRng(2);
  assert.equal(DECLINE_CHOICES.never(1, 5, rng), 'accept');
  assert.equal(DECLINE_CHOICES.ifMore(1, 5, rng), 'decline');
  assert.equal(DECLINE_CHOICES.ifMore(5, 1, rng), 'accept');
  assert.equal(DECLINE_CHOICES.ifMore(3, 3, rng), 'accept');
  assert.equal(DECLINE_CHOICES.ifLess(5, 1, rng), 'decline');
  assert.equal(DECLINE_CHOICES.ifLess(1, 5, rng), 'accept');
  assert.equal(DECLINE_CHOICES.ifLess(3, 3, rng), 'accept');
  let d = 0;
  for (let i = 0; i < 4000; i++) if (DECLINE_CHOICES.coin(1, 1, rng) === 'decline') d++;
  assert.ok(Math.abs(d / 4000 - 0.5) < 0.04);
});

test('classroom: declines follow the decline option during a run', () => {
  const run = (declineBy) => createSimulation({
    cfg: SMALL, rules: { declining: 'always', maxGamesPerPerson: 20 }, params: { declineBy }, seed: 12,
  }).run();
  const count = (sim) => sim.history.reduce((a, h) => a + h.declined, 0);
  assert.equal(count(run('never')), 0);
  assert.ok(count(run('coin')) > 0);
  const sim = createSimulation({ cfg: SMALL, rules: { declining: 'always' }, params: { declineBy: 'ifMore' }, seed: 13 });
  for (let t = 0; t < 10; t++) {
    const { pop } = sim.state;
    const n = Int32Array.from(pop.blue, (b, id) => b + pop.gold[id]); // before the tick
    for (const e of sim.step()) {
      if (e.outcome === 'declined') assert.ok(n[e.challenger] > n[e.target], 'declined only richer challengers');
    }
  }
});

test('scheduler: endReason says why a run stopped', () => {
  const time = createSimulation({ cfg: SMALL, rules: { maxGamesPerPerson: 5 }, seed: 14 }).run();
  assert.deepEqual(time.endReason, { reason: 'time' });
  const one = createSimulation({ cfg: SMALL, rules: { transfer: 'all', zeroNecklaces: 'out', maxGamesPerPerson: 5000 }, seed: 15 }).run();
  assert.equal(one.endReason.reason, 'oneHolder');
  assert.equal(one.endReason.total, 140);
  assert.equal(necklaceCount(one.state.pop, one.endReason.holder), 140);
  // only teachers hold necklaces and they may not play each other or students
  const stuck = createSimulation({
    cfg: { numStudents: 10, numStaff: 3, numBlue: 0, numGold: 3 },
    rules: { staffVsStudent: 'never', staffVsStaff: 'never', maxGamesPerPerson: 50 }, seed: 16,
  }).run();
  assert.equal(stuck.tick, 1);
  assert.deepEqual(stuck.endReason, { reason: 'stuck', holders: 3 });
  const running = createSimulation({ cfg: SMALL, seed: 17 });
  assert.equal(running.endReason, null);
});

test('scheduler: with zero-necklace players allowed, winner-takes-all runs to the time limit', () => {
  const sim = createSimulation({ cfg: SMALL, rules: { transfer: 'all', zeroNecklaces: 'canChallenge', declining: 'ifFewer', maxGamesPerPerson: 200 }, seed: 18 }).run();
  assert.equal(sim.tick, 200);
  assert.deepEqual(sim.endReason, { reason: 'time' });
});
