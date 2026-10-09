// Washburn Roshambo — challenge strategies and the scheduler that runs them.
//
// A strategy only decides *who challenges whom* (and, optionally, how they throw).
// The scheduler owns time, game budgets and rule enforcement, so a strategy can
// never break the rules: every pair it proposes is re-checked here.

import {
  createGameState, resolveChallenge, isActive, canChallenge, necklaceCount, totals,
} from './game.js';

// ---------- Registry ----------

const registry = new Map();

// def = {
//   id, name, description,
//   params: [{ key, label, type: 'range' | 'number', min, max, step, default }],
//   create(params) => {
//     init?(ctx),
//     selectPairs(ctx) => [[challengerId, targetId], ...],   // disjoint within a tick
//     moveChooser?(rng, history, personId, side) => 'rock' | 'paper' | 'scissors',
//   },
// }
// ctx = { pop, rules, rng, tick, isActive(id), canChallenge(a, b) }
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

// ---------- Built-in strategies ----------

// How far ahead in the shuffled list to look for a valid partner. Keeps each tick O(N).
const LOOKAHEAD = 50;

registerStrategy({
  id: 'random',
  name: 'Pairs are randomly chosen',
  description: 'Each tick, everyone still in the game who wants to play is shuffled and paired with '
    + 'a nearby partner they’re allowed to challenge. Who starts the challenge is random too.',
  params: [
    { key: 'participation', label: 'Chance a free person looks for a game each tick',
      type: 'range', min: 0.05, max: 1, step: 0.05, default: 1 },
  ],
  create({ participation = 1 } = {}) {
    return {
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
export function createSimulation({ cfg = {}, rules = {}, strategyId = 'random', params = {}, seed = Date.now() } = {}) {
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
  };
  strategy.init?.(ctx);

  const maxTicks = state.rules.maxGamesPerPerson;
  const history = [summarize(state, 0, [], 0)];
  let tick = 0;
  let done = maxTicks <= 0;
  let lastEvents = [];

  function choosersFor(a, b) {
    if (!strategy.moveChooser) return undefined;
    return {
      chooseA: (rng, h) => strategy.moveChooser(rng, h, a, 0),
      chooseB: (rng, h) => strategy.moveChooser(rng, h, b, 1),
    };
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
      events.push(resolveChallenge(state, a, b, choosersFor(a, b)));
    }
    lastEvents = events;
    history.push(summarize(state, tick, events, rejected));
    if (tick >= maxTicks || (events.length === 0 && !anyChallengePossible(ctx))) done = true;
    return events;
  }

  function run(n = Infinity) {
    for (let i = 0; i < n && !done; i++) step();
    return sim;
  }

  const sim = {
    state, history, strategy: def, maxTicks,
    get tick() { return tick; },
    get done() { return done; },
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
    games: events.length,
    rejected,
    active,
    out: pop.size - active,
    empty,
    maxHeld,
    ...totals(pop),
  };
}
