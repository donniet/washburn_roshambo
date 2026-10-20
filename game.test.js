import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng, MOVES, beats, playRound, playMatch, MAX_ROUNDS,
  DEFAULT_RULES, RULE_OPTIONS, STUDENT, STAFF, createPopulation, totals,
  isActive, canChallenge, challengeError, canDecline, declineError, transfer, transferBlocked, createGameState, resolveChallenge,
} from './game.js';

// Small hand-built population for rule tests: ids 0,1 students; 2,3 staff.
function tinyPop({ blue = [1, 1, 0, 0], gold = [0, 0, 1, 1], games = [0, 0, 0, 0] } = {}) {
  return {
    size: 4, numStudents: 2, numStaff: 2,
    role: Uint8Array.from([STUDENT, STUDENT, STAFF, STAFF]),
    blue: Int32Array.from(blue), gold: Int32Array.from(gold),
    gamesPlayed: Int32Array.from(games), slotsUsed: Int32Array.from(games),
    declines: new Int32Array(4), declinedAgainst: new Int32Array(4), declineChances: new Int32Array(4),
    strategyId: new Uint8Array(4),
  };
}
const rules = (r = {}) => ({ ...DEFAULT_RULES, ...r });

test('rng: same seed gives the same sequence; string seeds work', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const sa = Array.from({ length: 20 }, a.next), sb = Array.from({ length: 20 }, b.next);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, Array.from({ length: 20 }, c.next));
  assert.equal(createRng('monday').next(), createRng('monday').next());
  for (const v of sa) assert.ok(v >= 0 && v < 1);
  const r = createRng(1);
  for (let i = 0; i < 1000; i++) { const n = r.int(3); assert.ok(n >= 0 && n < 3 && Number.isInteger(n)); }
});

test('rng: shuffle is a permutation', () => {
  const arr = Array.from({ length: 50 }, (_, i) => i);
  const s = createRng(7).shuffle(arr.slice());
  assert.deepEqual([...s].sort((x, y) => x - y), arr);
});

test('roshambo: beats / playRound truth table', () => {
  assert.ok(beats('rock', 'scissors'));
  assert.ok(beats('scissors', 'paper'));
  assert.ok(beats('paper', 'rock'));
  for (const a of MOVES) for (const b of MOVES) {
    const expected = a === b ? 0 : beats(a, b) ? 1 : -1;
    assert.equal(playRound(a, b), expected);
    if (a !== b) assert.notEqual(beats(a, b), beats(b, a));
  }
});

test('roshambo: a match ends with the winner on exactly 2 decisive wins', () => {
  const rng = createRng(99);
  for (let i = 0; i < 2000; i++) {
    const m = playMatch(rng);
    const winsA = m.rounds.filter((r) => r.result > 0).length;
    const winsB = m.rounds.filter((r) => r.result < 0).length;
    assert.equal(m.coinFlip, false);
    assert.equal(Math.max(winsA, winsB), 2);
    assert.ok(Math.min(winsA, winsB) <= 1);
    assert.equal(m.winner, winsA === 2 ? 0 : 1);
    // the last round is always decisive
    assert.notEqual(m.rounds[m.rounds.length - 1].result, 0);
  }
});

test('roshambo: ties are replayed and do not count', () => {
  const script = [['rock', 'rock'], ['paper', 'rock'], ['scissors', 'scissors'], ['scissors', 'paper']];
  let i = 0;
  const m = playMatch(createRng(1), () => script[i][0], () => script[i++][1]);
  assert.equal(m.rounds.length, 4);
  assert.equal(m.winner, 0);
});

test('roshambo: endless ties fall back to a coin flip', () => {
  const m = playMatch(createRng(1), () => 'rock', () => 'rock');
  assert.equal(m.rounds.length, MAX_ROUNDS);
  assert.equal(m.coinFlip, true);
  assert.ok(m.winner === 0 || m.winner === 1);
});

test('roshambo: same seed gives the same match', () => {
  assert.deepEqual(playMatch(createRng('x')), playMatch(createRng('x')));
});

test('rules: RULE_OPTIONS covers every default', () => {
  for (const [key, group] of Object.entries(RULE_OPTIONS)) {
    assert.ok(group.options.some((o) => o.value === DEFAULT_RULES[key]), key);
  }
});

test('population: defaults give everyone one necklace of their colour', () => {
  const pop = createPopulation({}, createRng(1));
  assert.equal(pop.size, 1750);
  for (let id = 0; id < pop.size; id++) {
    if (id < 1600) { assert.equal(pop.role[id], STUDENT); assert.equal(pop.blue[id], 1); assert.equal(pop.gold[id], 0); }
    else { assert.equal(pop.role[id], STAFF); assert.equal(pop.gold[id], 1); assert.equal(pop.blue[id], 0); }
  }
});

test('population: fewer necklaces go to a random, seeded subset', () => {
  const cfg = { numStudents: 100, numStaff: 10, numBlue: 30, numGold: 4 };
  const a = createPopulation(cfg, createRng(5));
  const b = createPopulation(cfg, createRng(5));
  const c = createPopulation(cfg, createRng(6));
  const t = totals(a);
  assert.equal(t.blue, 30); assert.equal(t.gold, 4);
  assert.equal(t.staffBlue, 0); assert.equal(t.studentGold, 0);
  assert.ok(Math.max(...a.blue) <= 1);
  assert.deepEqual(a.blue, b.blue);
  assert.notDeepEqual(a.blue, c.blue);
  // not simply the first 30 students
  assert.notDeepEqual([...a.blue.slice(0, 30)], new Array(30).fill(1));
});

test('population: more necklaces than people — everyone has one, extras dealt', () => {
  const pop = createPopulation({ numStudents: 10, numStaff: 2, numBlue: 25, numGold: 5 }, createRng(3));
  const t = totals(pop);
  assert.equal(t.blue, 25); assert.equal(t.gold, 5);
  for (let id = 0; id < 10; id++) assert.ok(pop.blue[id] >= 1);
});

test('population: an empty group receives nothing', () => {
  const pop = createPopulation({ numStudents: 5, numStaff: 0, numBlue: 5, numGold: 10 }, createRng(3));
  assert.equal(totals(pop).gold, 0);
});

test('eligibility: staff vs student rule (directed)', () => {
  const pop = tinyPop();
  const s = 0, t = 2;
  assert.ok(canChallenge(pop, s, t, rules({ staffVsStudent: 'allowed' })));
  assert.ok(canChallenge(pop, t, s, rules({ staffVsStudent: 'allowed' })));
  assert.ok(canChallenge(pop, s, t, rules({ staffVsStudent: 'studentsMayChallengeStaff' })));
  assert.ok(!canChallenge(pop, t, s, rules({ staffVsStudent: 'studentsMayChallengeStaff' })));
  assert.ok(!canChallenge(pop, s, t, rules({ staffVsStudent: 'never' })));
  assert.ok(!canChallenge(pop, t, s, rules({ staffVsStudent: 'never' })));
  for (const staffVsStudent of ['allowed', 'studentsMayChallengeStaff', 'never']) {
    assert.ok(canChallenge(pop, 0, 1, rules({ staffVsStudent })), 'student vs student always ok');
    assert.ok(canChallenge(pop, 2, 3, rules({ staffVsStudent })), 'staff vs staff always ok');
  }
});

test('eligibility: zero-necklace rule, targets need a necklace, self, game limit', () => {
  const pop = tinyPop({ blue: [0, 1, 0, 0], gold: [0, 0, 1, 0] });
  // 0 has nothing, 3 has nothing
  assert.ok(!isActive(pop, 0, rules({ zeroNecklaces: 'out' })));
  assert.ok(isActive(pop, 0, rules({ zeroNecklaces: 'canChallenge' })));
  assert.ok(!canChallenge(pop, 0, 1, rules({ zeroNecklaces: 'out' })));
  assert.ok(canChallenge(pop, 0, 1, rules({ zeroNecklaces: 'canChallenge' })));
  assert.ok(!canChallenge(pop, 1, 0, rules({ zeroNecklaces: 'canChallenge' })), 'target with nothing');
  assert.ok(!canChallenge(pop, 1, 1, rules()), 'self');
  assert.ok(challengeError(pop, 1, 99, rules()));
  const tired = tinyPop({ games: [5, 0, 0, 0] });
  assert.ok(!isActive(tired, 0, rules({ maxGamesPerPerson: 5 })));
  assert.ok(!canChallenge(tired, 0, 1, rules({ maxGamesPerPerson: 5 })));
  assert.ok(!canChallenge(tired, 1, 0, rules({ maxGamesPerPerson: 5 })));
  assert.ok(canChallenge(tired, 1, 0, rules({ maxGamesPerPerson: 6 })));
});

test('transfer: each mode moves exactly what it should', () => {
  const rng = createRng(1);
  const make = () => tinyPop({ blue: [0, 3, 0, 0], gold: [0, 2, 0, 0] });
  let pop = make();
  assert.deepEqual(transfer(pop, 0, 1, rules({ transfer: 'all' }), rng), { blue: 3, gold: 2 });
  assert.deepEqual([pop.blue[0], pop.gold[0], pop.blue[1], pop.gold[1]], [3, 2, 0, 0]);

  pop = make();
  assert.deepEqual(transfer(pop, 0, 1, rules({ transfer: 'goldFirst' }), rng), { blue: 0, gold: 1 });
  pop = make();
  assert.deepEqual(transfer(pop, 0, 1, rules({ transfer: 'blueFirst' }), rng), { blue: 1, gold: 0 });
  pop = tinyPop({ blue: [0, 2, 0, 0], gold: [0, 0, 0, 0] });
  assert.deepEqual(transfer(pop, 0, 1, rules({ transfer: 'goldFirst' }), rng), { blue: 1, gold: 0 }, 'falls back to blue');
  pop = tinyPop({ blue: [0, 0, 0, 0], gold: [0, 2, 0, 0] });
  assert.deepEqual(transfer(pop, 0, 1, rules({ transfer: 'blueFirst' }), rng), { blue: 0, gold: 1 }, 'falls back to gold');

  // oneRandom: one necklace, weighted by counts (3 blue : 1 gold → ~75% blue)
  let blueTaken = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    pop = tinyPop({ blue: [0, 3, 0, 0], gold: [0, 1, 0, 0] });
    const m = transfer(pop, 0, 1, rules({ transfer: 'oneRandom' }), rng);
    assert.equal(m.blue + m.gold, 1);
    blueTaken += m.blue;
  }
  assert.ok(Math.abs(blueTaken / N - 0.75) < 0.04, `blue share ${blueTaken / N}`);
});

test('transfer: a zero-necklace loser gives nothing', () => {
  for (const t of ['all', 'oneRandom', 'goldFirst', 'blueFirst']) {
    const pop = tinyPop({ blue: [0, 1, 0, 0], gold: [0, 0, 0, 0] });
    assert.deepEqual(transfer(pop, 1, 0, rules({ transfer: t }), createRng(1)), { blue: 0, gold: 0 });
    assert.equal(pop.blue[1], 1);
  }
});

test('engine: resolveChallenge rejects illegal challenges without changing anything', () => {
  const state = createGameState({ cfg: { numStudents: 4, numStaff: 2 }, rules: { staffVsStudent: 'never' }, seed: 1 });
  const ev = resolveChallenge(state, 0, 4);
  assert.equal(ev.ok, false);
  assert.match(ev.reason, /never|don’t play/);
  assert.equal(state.pop.gamesPlayed[0], 0);
});

test('engine: resolveChallenge plays, transfers and counts the game', () => {
  const state = createGameState({ cfg: { numStudents: 4, numStaff: 2 }, rules: { transfer: 'oneRandom' }, seed: 2 });
  const ev = resolveChallenge(state, 0, 4);
  assert.equal(ev.ok, true);
  assert.equal(ev.outcome, 'played');
  assert.ok([0, 4].includes(ev.winner));
  assert.equal(ev.moved.blue + ev.moved.gold, 1);
  assert.equal(state.pop.gamesPlayed[0], 1);
  assert.equal(state.pop.gamesPlayed[4], 1);
  const w = ev.winner === 0 ? 0 : 1;
  assert.equal(ev.after[w].blue + ev.after[w].gold, ev.before[w].blue + ev.before[w].gold + 1);
});

test('engine: necklaces are conserved over 10,000 random challenges under every rule set', () => {
  for (const transferRule of ['all', 'oneRandom', 'goldFirst', 'blueFirst']) {
    for (const zeroNecklaces of ['out', 'canChallenge']) {
      const state = createGameState({
        cfg: { numStudents: 60, numStaff: 10 },
        rules: { transfer: transferRule, zeroNecklaces, maxGamesPerPerson: 1e9 },
        seed: `${transferRule}-${zeroNecklaces}`,
      });
      const before = totals(state.pop);
      for (let i = 0; i < 10000 / 8; i++) {
        resolveChallenge(state, state.rng.int(70), state.rng.int(70));
      }
      const after = totals(state.pop);
      assert.equal(after.blue, before.blue);
      assert.equal(after.gold, before.gold);
      for (let id = 0; id < 70; id++) assert.ok(state.pop.blue[id] >= 0 && state.pop.gold[id] >= 0);
    }
  }
});

test('eligibility: teachers vs teachers rule', () => {
  const pop = tinyPop();
  assert.ok(canChallenge(pop, 2, 3, rules({ staffVsStaff: 'allowed' })));
  assert.ok(!canChallenge(pop, 2, 3, rules({ staffVsStaff: 'never' })));
  assert.match(challengeError(pop, 2, 3, rules({ staffVsStaff: 'never' })), /each other/);
  assert.ok(canChallenge(pop, 0, 1, rules({ staffVsStaff: 'never' })), 'students unaffected');
  assert.ok(canChallenge(pop, 0, 2, rules({ staffVsStaff: 'never' })), 'student vs teacher unaffected');
});

test('declining: the rule only says whether students may decline; teachers never may', () => {
  // 0: student with 1, 1: student with 3, 2: teacher with 1, 3: teacher with 5
  const pop = tinyPop({ blue: [1, 2, 0, 0], gold: [0, 1, 1, 5] });
  const may = (declining, c, t) => canDecline(pop, c, t, rules({ declining }));
  for (const declining of ['never', 'allowed']) {
    assert.ok(!may(declining, 0, 2), `teachers always accept (${declining})`);
    assert.ok(!may(declining, 1, 3), `teachers always accept (${declining})`);
  }
  assert.ok(!may('never', 1, 0) && !may('never', 0, 1));
  // allowed regardless of who holds more
  assert.ok(may('allowed', 1, 0) && may('allowed', 0, 1) && may('allowed', 3, 0) && may('allowed', 2, 1));
  assert.match(declineError(pop, 0, 2, rules({ declining: 'allowed' })), /Teachers/);
  assert.match(declineError(pop, 0, 1, rules({ declining: 'never' })), /isn’t allowed/);
  assert.deepEqual(RULE_OPTIONS.declining.options.map((o) => o.value), ['never', 'allowed']);
});

test('declining: a decline moves nothing and uses a time slot for both', () => {
  const state = createGameState({ cfg: { numStudents: 4, numStaff: 2 }, rules: { declining: 'allowed' }, seed: 3 });
  const { pop } = state;
  const before = totals(pop);
  const ev = resolveChallenge(state, 0, 1, { respond: () => 'decline' });
  assert.equal(ev.ok, true);
  assert.equal(ev.outcome, 'declined');
  assert.equal(ev.winner, null);
  assert.deepEqual(ev.rounds, []);
  assert.deepEqual(ev.moved, { blue: 0, gold: 0 });
  assert.deepEqual(totals(pop), before);
  assert.deepEqual([pop.slotsUsed[0], pop.slotsUsed[1]], [1, 1]);
  assert.deepEqual([pop.gamesPlayed[0], pop.gamesPlayed[1]], [0, 0]);
  assert.equal(pop.declines[1], 1);
  assert.equal(pop.declineChances[1], 1);
  assert.equal(pop.declinedAgainst[0], 1);
  // accepting a declinable challenge still counts as a chance
  resolveChallenge(state, 2, 1, { respond: () => 'accept' });
  assert.equal(pop.declineChances[1], 2);
  assert.equal(pop.declines[1], 1);
});

test('declining: respond is ignored when the rules don’t allow a decline', () => {
  let asked = 0;
  const respond = () => { asked++; return 'decline'; };
  const state = createGameState({ cfg: { numStudents: 4, numStaff: 2 }, rules: { declining: 'never' }, seed: 4 });
  assert.equal(resolveChallenge(state, 0, 1, { respond }).outcome, 'played');
  const s2 = createGameState({ cfg: { numStudents: 4, numStaff: 2 }, rules: { declining: 'allowed' }, seed: 4 });
  assert.equal(resolveChallenge(s2, 0, 4, { respond }).outcome, 'played', 'teacher target');
  assert.equal(asked, 0);
  assert.equal(resolveChallenge(s2, 0, 1, { respond: () => 'accept' }).outcome, 'played');
  assert.equal(state.pop.declineChances[1], 0, 'no chance when declining is off');
  assert.equal(s2.pop.declineChances[4], 0, 'teachers never get a chance');
  assert.equal(s2.pop.declineChances[1], 1);
});

test('declining: declines count toward the time-slot limit', () => {
  const state = createGameState({ cfg: { numStudents: 3, numStaff: 0 }, rules: { declining: 'allowed', maxGamesPerPerson: 2 }, seed: 5 });
  const respond = () => 'decline';
  resolveChallenge(state, 0, 1, { respond });
  resolveChallenge(state, 0, 2, { respond });
  assert.ok(!isActive(state.pop, 0, state.rules));
  const ev = resolveChallenge(state, 0, 1, { respond });
  assert.equal(ev.ok, false);
  assert.match(ev.reason, /time slots/);
});

test('teachersTakeFromStudents: unchecked, a teacher who beats a student takes nothing', () => {
  const rng = createRng(1);
  // 0,1 students with 2 blue; 2,3 teachers with 1 gold
  const make = () => tinyPop({ blue: [2, 2, 0, 0], gold: [0, 0, 1, 1] });
  const off = rules({ teachersTakeFromStudents: false, transfer: 'all' });
  let pop = make();
  assert.equal(transferBlocked(pop, 2, 0, off), 'teachersCantTake');
  assert.deepEqual(transfer(pop, 2, 0, off, rng), { blue: 0, gold: 0 });
  assert.deepEqual([pop.blue[0], pop.gold[2]], [2, 1], 'nothing moved');
  // students still take from teachers, and same-role games are unaffected
  pop = make();
  assert.equal(transferBlocked(pop, 0, 2, off), null);
  assert.deepEqual(transfer(pop, 0, 2, off, rng), { blue: 0, gold: 1 }, 'student beats teacher');
  pop = make();
  assert.deepEqual(transfer(pop, 1, 0, off, rng), { blue: 2, gold: 0 }, 'student beats student');
  pop = make();
  assert.deepEqual(transfer(pop, 3, 2, off, rng), { blue: 0, gold: 1 }, 'teacher beats teacher');
  // checked (the default) keeps the old behaviour
  pop = make();
  assert.equal(DEFAULT_RULES.teachersTakeFromStudents, true);
  assert.deepEqual(transfer(pop, 2, 0, rules({ transfer: 'all' }), rng), { blue: 2, gold: 0 });
});

test('teachersTakeFromStudents: resolveChallenge reports the block and still counts the game', () => {
  const state = createGameState({
    cfg: { numStudents: 1, numStaff: 1, numBlue: 1, numGold: 50 },
    rules: { teachersTakeFromStudents: false, transfer: 'oneRandom', maxGamesPerPerson: 1000 },
    seed: 3,
  });
  const { pop } = state;
  let blockedSeen = 0, studentWins = 0;
  for (let i = 0; i < 40; i++) {
    const ev = resolveChallenge(state, 0, 1);
    if (!ev.ok) break; // someone ran out of necklaces
    if (ev.winner === 1) {
      assert.equal(ev.blocked, 'teachersCantTake');
      assert.deepEqual(ev.moved, { blue: 0, gold: 0 });
      blockedSeen++;
    } else {
      assert.equal(ev.blocked, null);
      studentWins++;
    }
  }
  assert.ok(blockedSeen > 0 && studentWins > 0);
  assert.equal(pop.blue[0], 1, 'the student never lost their blue necklace');
  assert.equal(totals(pop).blue + totals(pop).gold, 51);
});
