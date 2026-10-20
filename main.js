// Washburn Roshambo — wires the page controls to the game, strategies and views.

import {
  DEFAULT_RULES, DEFAULT_POPULATION, RULE_OPTIONS, createRng, playMatch, resolveChallenge, isActive,
  challengeError, declineError,
} from './game.js';
import {
  createSimulation, listStrategies, getStrategy, defaultParams, summarize, DEFAULT_STRATEGY, paramEnabled,
} from './strategies.js';
import {
  renderMatch, renderDecline, createPopulationView, createDeclineView,
  toCsv, populationRows, roleHistogramRows, colorHistogramRows, trendRows, declineRows, slug, createHistogramView, createColorHistogramView, createTrendView,
  personLabel, fmtInt, fmtPct, pct, fmtClock,
} from './game-view.js';

// ---------- config (pure) ----------

const LIMITS = {
  numStudents: [0, 10000],
  numStaff: [0, 2000],
  numBlue: [0, 100000],
  numGold: [0, 100000],
  maxGamesPerPerson: [1, 5000],
};

function clampInt(raw, [lo, hi], fallback) {
  const n = Math.round(Number(raw));
  if (raw === '' || raw == null || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// Turn raw form values (strings) into simulation settings, falling back to defaults
// and clamping anything out of range. Missing keys get defaults.
export function readConfig(values = {}) {
  const cfg = {};
  for (const key of ['numStudents', 'numStaff', 'numBlue', 'numGold']) {
    cfg[key] = clampInt(values[key], LIMITS[key], DEFAULT_POPULATION[key]);
  }
  if (cfg.numStudents + cfg.numStaff === 0) cfg.numStudents = 1;

  const rules = { ...DEFAULT_RULES };
  for (const [key, { options, toggles = [] }] of Object.entries(RULE_OPTIONS)) {
    if (options.some((o) => o.value === values[key])) rules[key] = values[key];
    // Checkboxes arrive as 'yes' / 'no' (see formValues); anything else keeps the default.
    for (const t of toggles) {
      if (values[t.key] === 'yes') rules[t.key] = true;
      else if (values[t.key] === 'no') rules[t.key] = false;
    }
  }
  rules.maxGamesPerPerson = clampInt(values.maxGamesPerPerson, LIMITS.maxGamesPerPerson, DEFAULT_RULES.maxGamesPerPerson);

  const ids = listStrategies().map((s) => s.id);
  const strategyId = ids.includes(values.strategyId) ? values.strategyId : DEFAULT_STRATEGY;
  const def = getStrategy(strategyId);
  const params = defaultParams(def);
  for (const p of def.params) {
    const raw = values[`param:${p.key}`];
    if (raw === undefined || raw === '') continue;
    if (p.type === 'select') {
      if (p.options.some((o) => o.value === raw)) params[p.key] = raw;
      continue;
    }
    const v = Number(raw);
    if (Number.isFinite(v)) params[p.key] = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
  }

  const seedRaw = String(values.seed ?? '').trim();
  const seed = seedRaw === '' ? 'washburn' : /^-?\d+$/.test(seedRaw) ? Number(seedRaw) : seedRaw;

  return { cfg, rules, strategyId, params, seed };
}

// Plain-language reason a finished run stopped.
export function endMessage(sim) {
  const end = sim.endReason;
  if (!end || end.reason === 'time') return `Finished: everyone used their ${fmtInt(sim.maxTicks)} time slots.`;
  const { pop, rules } = sim.state;
  const keepPlaying = rules.zeroNecklaces === 'out'
    ? ' To keep everyone playing, set “People with zero necklaces” to “CAN still challenge”.' : '';
  if (end.reason === 'oneHolder') {
    return `Finished early at tick ${fmtInt(sim.tick)}: ${personLabel(pop, end.holder)} holds all ${fmtInt(end.total)} necklaces`
      + `${rules.zeroNecklaces === 'out' ? ' and everyone else is out' : ''}.${keepPlaying}`;
  }
  return `Finished early at tick ${fmtInt(sim.tick)}: ${fmtInt(end.holders)} people still hold necklaces, `
    + `but the rules don’t let anyone still playing challenge them.${keepPlaying}`;
}

// ---------- page ----------

function init() {
  const $ = (id) => document.getElementById(id);
  const form = $('setup');

  // Build rule radio groups from RULE_OPTIONS.
  const rulesBox = $('rules');
  for (const [key, group] of Object.entries(RULE_OPTIONS)) {
    const fs = document.createElement('fieldset');
    fs.className = 'control rule';
    fs.innerHTML = `<legend>${group.label}</legend>`;

    for (const o of group.options) {
      const label = document.createElement('label');
      label.className = 'radio';
      label.innerHTML = `<input type="radio" name="${key}" value="${o.value}"${o.value === DEFAULT_RULES[key] ? ' checked' : ''}> <span>${o.label}</span>`;
      fs.append(label);
    }
    for (const t of group.toggles || []) {
      const label = document.createElement('label');
      label.className = 'radio rule-toggle';
      label.innerHTML = `<input type="checkbox" name="${t.key}"${DEFAULT_RULES[t.key] ? ' checked' : ''}> <span>${t.label}</span>`;
      fs.append(label);
      if (t.note) {
        const note = document.createElement('p');
        note.className = 'rule-note';
        note.textContent = t.note;
        fs.append(note);
      }
    }
    if (group.note) {
      const note = document.createElement('p');
      note.className = 'rule-note';
      note.textContent = group.note;
      fs.append(note);
    }
    rulesBox.append(fs);
  }

  // Strategy dropdown + per-strategy parameter controls.
  const stratSel = $('strategy');
  for (const s of listStrategies()) stratSel.append(new Option(s.name, s.id));
  function buildParams() {
    const def = getStrategy(stratSel.value);
    $('strategy-desc').textContent = def.description;
    const box = $('strategy-params');
    box.textContent = '';
    for (const p of def.params) {
      const wrap = document.createElement('div');
      wrap.className = 'control';
      const id = `param-${p.key}`;
      if (p.type === 'select') {
        wrap.innerHTML = `<label for="${id}">${p.label}</label><select id="${id}" name="param:${p.key}"></select>`;
        const sel = wrap.querySelector('select');
        for (const o of p.options) sel.append(new Option(o.label, o.value, o.value === p.default, o.value === p.default));
      } else if (p.type === 'range') {
        wrap.innerHTML = `<label for="${id}">${p.label}</label>
          <div class="n-row"><input type="range" id="${id}" name="param:${p.key}"
            min="${p.min}" max="${p.max}" step="${p.step ?? 1}" value="${p.default}"><output for="${id}">${p.default}</output></div>`;
        const input = wrap.querySelector('input'), out = wrap.querySelector('output');
        input.addEventListener('input', () => { out.textContent = input.value; });
      } else {
        wrap.innerHTML = `<label for="${id}">${p.label}</label>
          <input type="number" id="${id}" name="param:${p.key}" min="${p.min}" max="${p.max}" step="${p.step ?? 1}" value="${p.default}">`;
      }
      if (p.enabledWhen) {
        wrap.dataset.param = p.key;
        const hint = document.createElement('p');
        hint.className = 'param-hint';
        hint.textContent = p.disabledHint || 'Not used under the current rules.';
        wrap.append(hint);
      }
      box.append(wrap);
    }
  }
  buildParams();

  // Grey out strategy settings the current rules make irrelevant (e.g. decline options
  // when declining isn't allowed). Disabled controls keep their value for later.
  function updateParamStates() {
    const def = getStrategy(stratSel.value);
    const { rules } = readConfig(formValues());
    for (const p of def.params) {
      if (!p.enabledWhen) continue;
      const wrap = $('strategy-params').querySelector(`[data-param="${p.key}"]`);
      const on = paramEnabled(p, rules);
      wrap.classList.toggle('disabled', !on);
      for (const input of wrap.querySelectorAll('input, select')) input.disabled = !on;
    }
  }
  stratSel.addEventListener('change', buildParams);

  // Views
  const matchBox = $('match');
  const popView = createPopulationView({
    svg: $('pop-chart'), wrap: $('pop-wrap'), tooltip: $('pop-tooltip'), sizeKey: $('pop-size-key'),
    onPick: (id) => {
      // Click fills the challenger first, then the target.
      const c = $('challenger'), t = $('target');
      if (c.dataset.picked !== 'yes') { c.value = id; c.dataset.picked = 'yes'; }
      else { t.value = id; c.dataset.picked = ''; }
    },
  });
  const histView = createHistogramView({ svg: $('hist-chart'), wrap: $('hist-wrap'), tooltip: $('hist-tooltip'), note: $('hist-note') });
  const colorView = createColorHistogramView({ svg: $('color-chart'), wrap: $('color-wrap'), tooltip: $('color-tooltip'), note: $('color-note') });
  const declineView = createDeclineView({ svg: $('decline-chart'), wrap: $('decline-wrap'), tooltip: $('decline-tooltip'), note: $('decline-note') });
  const trendView = createTrendView({ svg: $('trend-chart'), wrap: $('trend-wrap'), tooltip: $('trend-tooltip') });

  let sim = null;
  let playing = false;

  function formValues() {
    const fd = new FormData(form);
    const v = Object.fromEntries(fd.entries());
    // Unchecked boxes are missing from FormData, so spell every toggle out.
    for (const group of Object.values(RULE_OPTIONS)) {
      for (const t of group.toggles || []) v[t.key] = form.elements[t.key].checked ? 'yes' : 'no';
    }
    v.strategyId = stratSel.value;
    return v;
  }

  function reset() {
    stop();
    updateParamStates();
    const conf = readConfig(formValues());
    sim = createSimulation(conf);
    $('max-ticks').textContent = fmtInt(sim.maxTicks);
    $('clock-hint').textContent = `${fmtInt(sim.maxTicks)} slots × 5 s each = ${fmtClock(sim.maxTicks)} of passing time. Each game or decline uses one slot.`;
    $('challenger').max = $('target').max = sim.state.pop.size - 1;
    $('status').textContent = `New run · seed “${conf.seed}” · ${fmtInt(sim.state.pop.size)} people`;
    render(true);
  }

  function render(full = false) {
    const { pop, rules } = sim.state;
    const h = sim.history[sim.history.length - 1];
    const totalGames = sim.history.reduce((a, x) => a + x.games, 0);
    const totalDeclined = sim.history.reduce((a, x) => a + (x.declined || 0), 0);
    $('stat-tick').textContent = fmtInt(sim.tick);
    $('stat-clock').textContent = fmtClock(sim.tick);
    $('stat-games').textContent = fmtInt(totalGames);
    $('stat-games-sub').textContent = `${fmtInt(h.games)} in the last tick`;
    $('stat-active').textContent = fmtInt(h.active);
    $('stat-active-sub').textContent = `${fmtInt(h.out)} out`;
    $('stat-empty').textContent = fmtInt(h.empty);
    $('stat-gold-students').textContent = fmtPct(pct(h.studentGold, h.gold));
    $('stat-gold-students-sub').textContent = `${fmtInt(h.studentGold)} of ${fmtInt(h.gold)} gold`;
    $('stat-blue-staff').textContent = fmtPct(pct(h.staffBlue, h.blue));
    $('stat-blue-staff-sub').textContent = `${fmtInt(h.staffBlue)} of ${fmtInt(h.blue)} blue`;
    $('stat-max').textContent = fmtInt(h.maxHeld);
    $('stat-max-sub').textContent = `of ${fmtInt(h.blue)} blue + ${fmtInt(h.gold)} gold in play`;
    $('stat-declined').textContent = fmtInt(totalDeclined);
    $('stat-declined-sub').textContent = rules.declining === 'never'
      ? 'declining is off' : `${fmtInt(h.declined || 0)} in the last tick`;
    if (sim.done && sim.tick > 0) $('status').textContent = endMessage(sim);
    $('play').textContent = playing ? '❚❚ Pause' : sim.done ? '✓ Finished' : '▶ Run';
    $('play').disabled = $('step').disabled = $('to-end').disabled = sim.done;
    $('replay').disabled = sim.lastEvents.length === 0;

    popView.update(pop, (id) => isActive(pop, id, rules));
    histView.update(pop);
    colorView.update(pop);
    declineView.update(pop);
    if (full || !playing || sim.history.length % 2 === 0 || sim.done) trendView.update(sim.history, sim.maxTicks);
  }

  // ---------- animation loop ----------
  let acc = 0, lastT = null;
  function frame(t) {
    if (!playing) return;
    const speed = Number($('speed').value); // ticks per second; 0 = as fast as possible
    if (speed === 0) {
      const start = performance.now();
      do sim.step(); while (!sim.done && performance.now() - start < 14);
    } else {
      if (lastT != null) acc += ((t - lastT) / 1000) * speed;
      lastT = t;
      while (acc >= 1 && !sim.done) { sim.step(); acc -= 1; }
    }
    if (sim.done) playing = false;
    render();
    if (playing) requestAnimationFrame(frame);
  }
  function start() {
    if (sim.done) return;
    playing = true; acc = 1; lastT = null;
    requestAnimationFrame(frame);
    render();
  }
  function stop() { playing = false; if (sim) render(); }

  // ---------- events ----------
  $('play').addEventListener('click', () => (playing ? stop() : start()));
  $('step').addEventListener('click', () => { stop(); sim.step(); render(true); });
  $('to-end').addEventListener('click', () => { stop(); sim.run(); render(true); });
  $('reset').addEventListener('click', reset);
  form.addEventListener('change', (e) => { if (e.target.name !== 'challenger' && e.target.name !== 'target') reset(); });
  form.addEventListener('submit', (e) => e.preventDefault());

  const practiceRng = createRng(Date.now());
  $('practice').addEventListener('click', () => {
    renderMatch(matchBox, playMatch(practiceRng), { labels: ['Player A', 'Player B'] });
  });

  function showEvent(ev, prefix = '') {
    const { pop } = sim.state;
    const labels = [`${prefix}${personLabel(pop, ev.challenger)}`, personLabel(pop, ev.target)];
    if (ev.outcome === 'declined') { renderDecline(matchBox, ev, { labels }); return; }
    renderMatch(matchBox, { rounds: ev.rounds, winner: ev.winner === ev.challenger ? 0 : 1, coinFlip: ev.coinFlip },
      { labels: [`${prefix}${personLabel(pop, ev.challenger)}`, personLabel(pop, ev.target)], detail: ev });
  }

  function showError(text) {
    matchBox.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'match-error';
    p.textContent = text;
    matchBox.append(p);
  }

  // Manual challenge from the ID boxes. `decline` asks the target to decline.
  function manualChallenge(decline) {
    stop();
    const c = Number($('challenger').value), t = Number($('target').value);
    const { pop, rules } = sim.state;
    if (decline) {
      const reason = challengeError(pop, c, t, rules) || declineError(pop, c, t, rules);
      if (reason) { showError(`Can’t decline: ${reason}.`); return; }
    }
    const ev = resolveChallenge(sim.state, c, t, { respond: () => (decline ? 'decline' : 'accept') });
    if (!ev.ok) { showError(`Not allowed: ${ev.reason}.`); return; }
    showEvent(ev);
    // A manual challenge changes the population between ticks: refresh the latest summary.
    const last = sim.history[sim.history.length - 1];
    sim.history[sim.history.length - 1] = {
      ...summarize(sim.state, last.tick, [], last.rejected),
      games: last.games + (ev.outcome === 'played' ? 1 : 0),
      declined: (last.declined || 0) + (ev.outcome === 'declined' ? 1 : 0),
    };
    render(true);
  }
  $('challenge').addEventListener('click', () => manualChallenge(false));
  $('decline').addEventListener('click', () => manualChallenge(true));
  $('random-pair').addEventListener('click', () => {
    const rng = practiceRng, { pop } = sim.state;
    $('challenger').value = rng.int(pop.size);
    $('target').value = rng.int(pop.size);
  });
  $('replay').addEventListener('click', () => {
    const evs = sim.lastEvents;
    if (evs.length) showEvent(evs[practiceRng.int(evs.length)]);
    document.getElementById('match-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ---------- CSV downloads ----------
  // Each link builds its file from the current run when clicked.
  const CSV_SOURCES = {
    everyone: () => populationRows(sim.state.pop),
    'by-role': () => roleHistogramRows(sim.state.pop),
    'by-colour': () => colorHistogramRows(sim.state.pop),
    'over-time': () => trendRows(sim.history),
    declining: () => declineRows(sim.state.pop),
  };
  for (const link of document.querySelectorAll('a.csv-link')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const key = link.dataset.csv;
      // UTF-8 byte-order mark so Excel reads the en dashes in bin labels correctly.
      const blob = new Blob(['\ufeff' + toCsv(CSV_SOURCES[key]())], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `washburn-roshambo_${key}_seed-${slug(sim.state.seed)}_tick-${sim.tick}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  reset();
  renderMatch(matchBox, playMatch(practiceRng), { labels: ['Player A', 'Player B'], animate: false });
}

if (typeof document !== 'undefined' && document.getElementById('setup')) init();
