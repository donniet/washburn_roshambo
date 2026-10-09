// Washburn Roshambo — challenge strategies and the scheduler that runs them.
//
// A strategy only decides *who challenges whom* (and, optionally, how they throw).
// The scheduler owns time, game budgets and rule enforcement, so a strategy can
// never break the rules: every pair it proposes is re-checked here.

import {
  createGameState, resolveChallenge, isActive, canChallenge, canDecline, necklaceCount, totals,
} from './game.js';

// ---------- Registry ----------

const registry = new Map();

// def = {
//   id, name, description,
//   params: [{ key, label, type: 'range' | 'number', min, max, step, default }
//            | { key, label, type: 'select', options: [{ value, label }], default }],
//   create(params) => {
//     init?(ctx),
//     selectPairs(ctx) => [[challengerId, targetId], ...],   // disjoint within a tick
//     respond?(ctx, challengerId, targetId) => 'accept' | 'decline',  // the target's choice
//     moveChooser?(rng, history, personId, side) => 'rock' | 'paper' | 'scissors',
//   },
// }
// ctx = { pop, rules, rng, tick, isActive(id), canChallenge(a, b), canDecline(a, b) }
// respond() is only called when the rules let that target decline; without it, targets accept.
export function registerStrategy(def) {
  if (!def || !def.id || typeof def.create !== 'function') throw new Error('Strategy needs an id and create()');
  if (registry.has(def.id)) throw new Error(`Strategy "${def.id}" is already registered`);
  registry.set(def.id, { params: [], description: '', ...def });
  return def;
}

export const listStrategies = () => [...registry.values()];

export function getStrategy(id) {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown strategy "${id}"`);
  return def;
}

export function defaultParams(def) {
  const out = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

export const DEFAULT_STRATEGY = 'classroom';

// ---------- Built-in strategies ----------

// Up to k distinct random ids from 0…n-1, never `exclude`. Order is random.
export function sampleGroup(rng, n, k, exclude) {
  const want = Math.min(k, n - 1);
  if (want <= 0) return [];
  if (want * 2 > n) {
    // big group: shuffle everyone and take a prefix
    const all = [];
    for (let id = 0; id < n; id++) if (id !== exclude) all.push(id);
    return rng.shuffle(all).slice(0, want);
  }
  const seen = new Set([exclude]);
  const out = [];
  while (out.length < want) {
    const id = rng.int(n);
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

// Pick a target from the group by score (total necklaces). Earlier entries win ties,
// and the group is in random order, so ties are broken at random.
export const CHALLENGE_PICKERS = {
  random: (group) => group[0],
  highest: (group, score) => group.reduce((best, id) => (score(id) > score(best) ? id : best)),
  lowest: (group, score) => group.reduce((best, id) => (score(id) < score(best) ? id : best)),
};

// The target's answer, when the rules let them decline.
export const DECLINE_CHOICES = {
  never: () => 'accept',
  ifMore: (mine, theirs) => (theirs > mine ? 'decline' : 'accept'),
  ifLess: (mine, theirs) => (theirs < mine ? 'decline' : 'accept'),
  coin: (mine, theirs, rng) => (rng.next() < 0.5 ? 'decline' : 'accept'),
};

registerStrategy({
  id: 'classroom',
  name: 'Students choose from a classroom',
  description: 'Each tick, everyone still playing is shuffled. Each person not yet paired looks over a random group '
    + '(about one classroom) and challenges someone in it they’re allowed to challenge, picked by the challenge option. '
    + 'When the rules let them decline, a student uses the decline option. Score = total necklaces held.',
  params: [
    { key: 'challengeBy', label: 'Who they challenge', type: 'select', default: 'random',
      options: [
        { value: 'random', label: 'Challenge at random' },
        { value: 'highest', label: 'Challenge the HIGHEST scorer they can' },
        { value: 'lowest', label: 'Challenge the LOWEST scorer (above 0) they can' },
      ] },
    { key: 'declineBy', label: 'When they decline', type: 'select', default: 'never',
      options: [
        { value: 'never', label: 'Never decline' },
        { value: 'ifMore', label: 'Decline if allowed and the challenger has MORE necklaces' },
        { value: 'ifLess', label: 'Decline if allowed and the challenger has LESS necklaces' },
        { value: 'coin', label: 'Decline with a coin flip (if allowed)' },
      ] },
    { key: 'groupSize', label: 'Challenge group size', type: 'number', min: 1, max: 5000, step: 1, default: 30 },
  ],
  create({ challengeBy = 'random', declineBy = 'never', groupSize = 30 } = {}) {
    const pick = CHALLENGE_PICKERS[challengeBy] ?? CHALLENGE_PICKERS.random;
    const decide = DECLINE_CHOICES[declineBy] ?? DECLINE_CHOICES.never;
    return {
      selectPairs(ctx) {
        const { pop, rng } = ctx;
        const score = (id) => necklaceCount(pop, id);
        const order = [];
        for (let id = 0; id < pop.size; id++) if (ctx.isActive(id)) order.push(id);
        rng.shuffle(order);
        const paired = new Uint8Array(pop.size);
        const pairs = [];
        for (const a of order) {
          if (paired[a]) continue;
          const group = sampleGroup(rng, pop.size, groupSize, a)
            .filter((b) => !paired[b] && ctx.canChallenge(a, b));
          if (group.length === 0) continue;
          const b = pick(group, score);
          paired[a] = paired[b] = 1;
          pairs.push([a, b]);
        }
        return pairs;
      },
      respond(ctx, challenger, target) {
        return decide(necklaceCount(ctx.pop, target), necklaceCount(ctx.pop, challenger), ctx.rng);
      },
    };
  },
});

// How far ahead in the shuffled list to look for a valid partner. Keeps each tick O(N).
const LOOKAHEAD = 50;

registerStrategy({
  id: 'random',
  name: 'Pairs are randomly chosen',
  description: 'Each tick, everyone still in the game who wants to play is shuffled and paired with '
    + 'a nearby partner they’re allowed to challenge. Who starts the challenge is random too. '
    + 'When the rules allow a decline, the student flips a weighted coin.',
  params: [
    { key: 'participation', label: 'Chance a free person looks for a game each tick',
      type: 'range', min: 0.05, max: 1, step: 0.05, default: 1 },
    { key: 'declineRate', label: 'Chance a student declines, when the rules allow it',
      type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  create({ participation = 1, declineRate = 0.5 } = {}) {
    return {
      respond(ctx) {
        return ctx.rng.next() < declineRate ? 'decline' : 'accept';
      },
      selectPairs(ctx) {
        const { pop, rng } = ctx;
        const pool = [];
        for (let id = 0; id < pop.size; id++) {
          if (ctx.isActive(id) && rng.next() < participation) pool.push(id);
        }
        rng.shuffle(pool);
        const paired = new Uint8Array(pop.size);
        const pairs = [];
        for (let x = 0; x < pool.length; x++) {
          const a = pool[x];
          if (paired[a]) continue;
          const end = Math.min(pool.length, x + 1 + LOOKAHEAD);
          for (let y = x + 1; y < end; y++) {
            const b = pool[y];
            if (paired[b]) continue;
            let pair = null;
            if (ctx.canChallenge(a, b)) pair = [a, b];
            else if (ctx.canChallenge(b, a)) pair = [b, a];
            if (pair) {
              paired[a] = paired[b] = 1;
              pairs.push(pair);
              break;
            }
          }
        }
        return pairs;
      },
    };
  },
});

// ---------- Scheduler ----------

// One tick = one game slot (5 s of passing time). Each person plays at most one game per tick,
// so the run lasts at most rules.maxGamesPerPerson ticks.
export function createSimulation({ cfg = {}, rules = {}, strategyId = DEFAULT_STRATEGY, params = {}, seed = Date.now() } = {}) {
  const state = createGameState({ cfg, rules, seed });
  const def = getStrategy(strategyId);
  const strategy = def.create({ ...defaultParams(def), ...params });
  const { pop } = state;

  const ctx = {
    pop,
    rules: state.rules,
    rng: state.rng,
    tick: 0,
    isActive: (id) => isActive(pop, id, state.rules),
    canChallenge: (a, b) => canChallenge(pop, a, b, state.rules),
    canDecline: (a, b) => canDecline(pop, a, b, state.rules),
  };
  strategy.init?.(ctx);

  const maxTicks = state.rules.maxGamesPerPerson;
  const history = [summarize(state, 0, [], 0)];
  let tick = 0;
  let done = maxTicks <= 0;
  let endReason = done ? endInfo('time') : null;
  let lastEvents = [];

  const respond = strategy.respond ? (a, b) => strategy.respond(ctx, a, b) : undefined;

  function optionsFor(a, b) {
    const opts = { respond };
    if (strategy.moveChooser) {
      opts.chooseA = (rng, h) => strategy.moveChooser(rng, h, a, 0);
      opts.chooseB = (rng, h) => strategy.moveChooser(rng, h, b, 1);
    }
    return opts;
  }

  function step() {
    if (done) return null;
    tick++;
    ctx.tick = tick;
    const proposed = strategy.selectPairs(ctx) || [];
    const used = new Uint8Array(pop.size);
    const events = [];
    let rejected = 0;
    for (const pair of proposed) {
      const [a, b] = pair || [];
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= pop.size || b >= pop.size
          || used[a] || used[b] || !ctx.canChallenge(a, b)) {
        rejected++;
        continue;
      }
      used[a] = used[b] = 1;
      events.push(resolveChallenge(state, a, b, optionsFor(a, b)));
    }
    lastEvents = events;
    history.push(summarize(state, tick, events, rejected));
    if (tick >= maxTicks) { done = true; endReason = endInfo('time'); }
    else if (events.length === 0 && !anyChallengePossible(ctx)) { done = true; endReason = endInfo('stuck'); }
    return events;
  }

  function endInfo(kind) {
    if (kind === 'time') return { reason: 'time' };
    const holders = [];
    let total = 0;
    for (let id = 0; id < pop.size; id++) {
      const n = necklaceCount(pop, id);
      if (n > 0) { holders.push(id); total += n; }
    }
    return holders.length === 1
      ? { reason: 'oneHolder', holder: holders[0], total }
      : { reason: 'stuck', holders: holders.length };
  }

  function run(n = Infinity) {
    for (let i = 0; i < n && !done; i++) step();
    return sim;
  }

  const sim = {
    state, history, strategy: def, maxTicks,
    get tick() { return tick; },
    get done() { return done; },
    // Why the run ended (null while running):
    //   { reason: 'time' }                      — the time slots ran out
    //   { reason: 'oneHolder', holder, total }  — one person holds every necklace
    //   { reason: 'stuck', holders }            — necklaces are spread out, but no legal challenge is left
    get endReason() { return endReason; },
    get lastEvents() { return lastEvents; },
    step, run,
  };
  return sim;
}

// Is there any legal challenge left? Only called when a tick produced no games.
function anyChallengePossible(ctx) {
  const { pop } = ctx;
  const active = [], targets = [];
  for (let id = 0; id < pop.size; id++) {
    if (!ctx.isActive(id)) continue;
    active.push(id);
    if (necklaceCount(pop, id) > 0) targets.push(id);
  }
  for (const a of active) for (const t of targets) if (ctx.canChallenge(a, t)) return true;
  return false;
}

// Per-tick summary used by the charts and counters.
// `games` counts challenges played this tick and `declined` the ones declined.
export function summarize(state, tick, events, rejected) {
  const { pop, rules } = state;
  let active = 0, empty = 0, maxHeld = 0;
  for (let id = 0; id < pop.size; id++) {
    if (isActive(pop, id, rules)) active++;
    const n = necklaceCount(pop, id);
    if (n === 0) empty++;
    if (n > maxHeld) maxHeld = n;
  }
  return {
    tick,
    games: events.filter((e) => e.outcome === 'played').length,
    declined: events.filter((e) => e.outcome === 'declined').length,
    rejected,
    active,
    out: pop.size - active,
    empty,
    maxHeld,
    ...totals(pop),
  };
}
