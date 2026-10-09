// Washburn Roshambo — core game logic.
// Pure functions only: no DOM access, so everything here runs under `node --test`.
//
// Sections: RNG · Roshambo · Rules · Population · Eligibility & transfer · Engine

// ---------- RNG ----------

// Seeded PRNG (mulberry32). Any run can be replayed exactly from its seed.
export function createRng(seed = Date.now()) {
  let s = hashSeed(seed);
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  return {
    seed,
    next,
    int,
    pick: (arr) => arr[int(arr.length)],
    // In-place Fisher–Yates; returns the same array.
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    },
  };
}

// Numbers are used as-is; strings ("monday-rules") are hashed so seeds can be words.
function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed | 0;
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h | 0;
}

// ---------- Roshambo ----------

export const MOVES = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export const beats = (a, b) => BEATS[a] === b;

// 1 = A wins the round, -1 = B wins, 0 = tie.
export function playRound(a, b) {
  if (a === b) return 0;
  return beats(a, b) ? 1 : -1;
}

// Move chooser signature: (rng, history, side) => move.
// `history` is the rounds so far; `side` is 0 for player A, 1 for player B.
export const uniformMove = (rng) => MOVES[rng.int(3)];

export const MAX_ROUNDS = 50;

// Best 2 out of 3 decisive rounds. Ties are replayed and don't count.
// If MAX_ROUNDS is hit (only possible with pathological choosers) a coin flip decides.
export function playMatch(rng, chooseA = uniformMove, chooseB = uniformMove) {
  const rounds = [];
  let winsA = 0, winsB = 0;
  while (winsA < 2 && winsB < 2) {
    if (rounds.length >= MAX_ROUNDS) {
      return { winner: rng.int(2), rounds, coinFlip: true };
    }
    const a = chooseA(rng, rounds, 0);
    const b = chooseB(rng, rounds, 1);
    const result = playRound(a, b);
    if (result > 0) winsA++;
    else if (result < 0) winsB++;
    rounds.push({ a, b, result });
  }
  return { winner: winsA === 2 ? 0 : 1, rounds, coinFlip: false };
}

// ---------- Rules ----------

export const DEFAULT_RULES = {
  transfer: 'oneRandom',
  staffVsStudent: 'allowed',
  zeroNecklaces: 'out',
  maxGamesPerPerson: 300, // 25 minutes of passing time ÷ 5 seconds per game
};

// Labels for every rule variation. The UI builds its radio groups from this,
// so a new variation only needs an entry here plus handling below.
export const RULE_OPTIONS = {
  transfer: {
    label: 'What the winner takes',
    options: [
      { value: 'all', label: 'All of the loser’s necklaces' },
      { value: 'oneRandom', label: 'One necklace, chosen at random' },
      { value: 'goldFirst', label: 'One gold necklace, or blue if they have none' },
      { value: 'blueFirst', label: 'One blue necklace, or gold if they have none' },
    ],
  },
  staffVsStudent: {
    label: 'Staff vs. students',
    options: [
      { value: 'allowed', label: 'Teachers CAN challenge students' },
      { value: 'studentsMayChallengeStaff', label: 'Teachers CANNOT challenge students (students may challenge teachers)' },
      { value: 'never', label: 'Students and teachers never play each other' },
    ],
  },
  zeroNecklaces: {
    label: 'People with zero necklaces',
    options: [
      { value: 'out', label: 'CANNOT challenge and are OUT' },
      { value: 'canChallenge', label: 'CAN still challenge (nothing to lose)' },
    ],
  },
};

// ---------- Population ----------

export const STUDENT = 0;
export const STAFF = 1;

export const DEFAULT_POPULATION = {
  numStudents: 1600,
  numStaff: 150,
  numBlue: 1600,
  numGold: 150,
};

// Struct-of-arrays: a person's ID is their index into every array.
// Students are IDs 0 … numStudents-1, staff follow.
export function createPopulation(cfg, rng) {
  const c = { ...DEFAULT_POPULATION, ...cfg };
  const n = c.numStudents + c.numStaff;
  const pop = {
    size: n,
    numStudents: c.numStudents,
    numStaff: c.numStaff,
    role: new Uint8Array(n),
    blue: new Int32Array(n),
    gold: new Int32Array(n),
    gamesPlayed: new Int32Array(n),
    strategyId: new Uint8Array(n), // reserved for per-person strategies
  };
  const students = [], staff = [];
  for (let id = 0; id < n; id++) {
    if (id < c.numStudents) students.push(id);
    else { pop.role[id] = STAFF; staff.push(id); }
  }
  deal(c.numBlue, students, pop.blue, rng);
  deal(c.numGold, staff, pop.gold, rng);
  return pop;
}

// Give `count` necklaces to a random subset of `ids`, one each. If there are more
// necklaces than people, everyone gets one and the extras land randomly.
// An empty group receives nothing.
function deal(count, ids, arr, rng) {
  if (ids.length === 0 || count <= 0) return;
  const order = rng.shuffle(ids.slice());
  const first = Math.min(count, order.length);
  for (let i = 0; i < first; i++) arr[order[i]]++;
  for (let i = first; i < count; i++) arr[order[rng.int(order.length)]]++;
}

export const holdings = (pop, id) => ({ blue: pop.blue[id], gold: pop.gold[id] });
export const necklaceCount = (pop, id) => pop.blue[id] + pop.gold[id];

export function totals(pop) {
  const t = { blue: 0, gold: 0, studentBlue: 0, studentGold: 0, staffBlue: 0, staffGold: 0 };
  for (let id = 0; id < pop.size; id++) {
    const b = pop.blue[id], g = pop.gold[id];
    t.blue += b; t.gold += g;
    if (pop.role[id] === STAFF) { t.staffBlue += b; t.staffGold += g; }
    else { t.studentBlue += b; t.studentGold += g; }
  }
  return t;
}

export function snapshot(pop) {
  return {
    ...pop,
    role: pop.role.slice(),
    blue: pop.blue.slice(),
    gold: pop.gold.slice(),
    gamesPlayed: pop.gamesPlayed.slice(),
    strategyId: pop.strategyId.slice(),
  };
}

// ---------- Eligibility & transfer ----------

export function isActive(pop, id, rules) {
  if (pop.gamesPlayed[id] >= rules.maxGamesPerPerson) return false;
  if (rules.zeroNecklaces === 'out' && necklaceCount(pop, id) === 0) return false;
  return true;
}

// Why `challenger` may not challenge `target`, or null if they may.
// Challenges are directed: who starts it matters for the staff/student rule.
export function challengeError(pop, challenger, target, rules) {
  if (!Number.isInteger(challenger) || challenger < 0 || challenger >= pop.size) return 'No such challenger';
  if (!Number.isInteger(target) || target < 0 || target >= pop.size) return 'No such target';
  if (challenger === target) return 'Can’t challenge yourself';
  if (pop.gamesPlayed[challenger] >= rules.maxGamesPerPerson) return 'Challenger is out of games';
  if (pop.gamesPlayed[target] >= rules.maxGamesPerPerson) return 'Target is out of games';
  if (necklaceCount(pop, target) === 0) return 'Target has no necklaces to win';
  if (rules.zeroNecklaces === 'out' && necklaceCount(pop, challenger) === 0) return 'Challenger has no necklaces and is out';
  const cRole = pop.role[challenger], tRole = pop.role[target];
  if (cRole !== tRole) {
    if (rules.staffVsStudent === 'never') return 'Students and teachers don’t play each other';
    if (rules.staffVsStudent === 'studentsMayChallengeStaff' && cRole === STAFF) return 'Teachers can’t challenge students';
  }
  return null;
}

export const canChallenge = (pop, challenger, target, rules) =>
  challengeError(pop, challenger, target, rules) === null;

// Move necklaces from loser to winner per the transfer rule. Returns what moved.
export function transfer(pop, winner, loser, rules, rng) {
  const b = pop.blue[loser], g = pop.gold[loser];
  let moved;
  if (b + g === 0) moved = { blue: 0, gold: 0 };
  else switch (rules.transfer) {
    case 'all': moved = { blue: b, gold: g }; break;
    case 'oneRandom': moved = rng.int(b + g) < g ? { blue: 0, gold: 1 } : { blue: 1, gold: 0 }; break;
    case 'goldFirst': moved = g > 0 ? { blue: 0, gold: 1 } : { blue: 1, gold: 0 }; break;
    case 'blueFirst': moved = b > 0 ? { blue: 1, gold: 0 } : { blue: 0, gold: 1 }; break;
    default: throw new Error(`Unknown transfer rule: ${rules.transfer}`);
  }
  pop.blue[loser] -= moved.blue; pop.gold[loser] -= moved.gold;
  pop.blue[winner] += moved.blue; pop.gold[winner] += moved.gold;
  return moved;
}

// ---------- Engine ----------

export function createGameState({ cfg = {}, rules = {}, seed = Date.now() } = {}) {
  const rng = createRng(seed);
  return { pop: createPopulation(cfg, rng), rules: { ...DEFAULT_RULES, ...rules }, rng, seed };
}

// Play one challenge: validate, best-of-3, transfer, count the game for both.
export function resolveChallenge(state, challenger, target, { chooseA, chooseB } = {}) {
  const { pop, rules, rng } = state;
  const reason = challengeError(pop, challenger, target, rules);
  if (reason) return { ok: false, challenger, target, reason };
  const before = [holdings(pop, challenger), holdings(pop, target)];
  const match = playMatch(rng, chooseA, chooseB);
  const winner = match.winner === 0 ? challenger : target;
  const loser = match.winner === 0 ? target : challenger;
  const moved = transfer(pop, winner, loser, rules, rng);
  pop.gamesPlayed[challenger]++;
  pop.gamesPlayed[target]++;
  return {
    ok: true, challenger, target, winner, loser,
    rounds: match.rounds, coinFlip: match.coinFlip, moved,
    before, after: [holdings(pop, challenger), holdings(pop, target)],
  };
}
