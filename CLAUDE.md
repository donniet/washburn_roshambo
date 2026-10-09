# Washburn Roshambo — bead necklace game simulator

A single-page browser simulator for a game played at a high school. Students start with **blue** necklaces and teachers with **gold** ones. The best-of-3 rock-paper-scissors winner takes necklace(s) from the loser. The finer rules are disputed, so the page lets you pick a rule set and challenge strategy and watch where the necklaces end up. Requirements live in [NOTES.md](NOTES.md).

Plain HTML/CSS/SVG/JS: ES modules, no build step, no dependencies.

## Commands
- **Serve:** `python3 -m http.server 8000` (or `npm run serve`), then open http://localhost:8000. ES modules don't load from `file://`.
- **Test:** `npm test` (= `node --test`, needs Node 20+).
  - Node isn't installed on this machine. To test here, run the `*.test.js` files in headless Chrome (`google-chrome --headless=new --dump-dom …`).
  - That needs a runner page with an import map pointing `node:test` and `node:assert/strict` at small shims. Keep the runner and shims in the scratchpad, not in the repo.

## Files
Keep the JS in these four files (the user asked for few files); each has a sibling `*.test.js`.

| File | Contents |
|---|---|
| `game.js` | Seeded RNG (mulberry32), Roshambo (`playMatch`), rules (`DEFAULT_RULES`, `RULE_OPTIONS`, `challengeError`/`canChallenge`, `isActive`, `transfer`), population (struct-of-arrays, ID = index), engine (`createGameState`, `resolveChallenge`). No DOM. |
| `strategies.js` | Strategy registry (`registerStrategy`, `listStrategies`, `getStrategy`), the built-in `random` strategy, and the scheduler (`createSimulation` → `step`/`run`/`history`). No DOM. |
| `game-view.js` | Match view, population dot grid, histogram and trend chart. DOM code runs only inside the create/render functions; pure helpers are exported and tested. |
| `main.js` | `readConfig(formValues)` (pure, tested) plus page wiring. Auto-inits only when `#setup` exists, so tests can import it. |

Dependencies go one way: `main.js` → `game-view.js` / `strategies.js` → `game.js`.

## Model and rules
- **Population:** typed arrays `role` (0 student / 1 staff), `blue`, `gold`, `gamesPlayed`, and `strategyId`.
  - `strategyId` is reserved for per-person strategies.
  - Students are IDs `0…numStudents-1`; staff follow.
- **Dealing necklaces:** if there are fewer necklaces than people, they go to a random (seeded) subset of the group. Extras are dealt randomly within the group. An empty group gets none.
- **Rule variations** (in `RULE_OPTIONS`; the UI builds its radio groups from it):
  - `transfer`: `all` | `oneRandom` (default; weighted by the loser's counts) | `goldFirst` | `blueFirst`;
  - `staffVsStudent`: `allowed` | `studentsMayChallengeStaff` | `never`. Challenges are *directed*;
  - `zeroNecklaces`: `out` | `canChallenge`;
  - `maxGamesPerPerson`: default **300**. 25 min ÷ 5 s = 300; NOTES.md's "1500" was an arithmetic slip.
- **Decisions confirmed with the user:**
  - The winner takes from the loser.
  - Ties are replayed and don't count. After 50 rounds, a coin flip decides.
  - A target must hold at least 1 necklace.
  - A zero-necklace challenger who loses gives nothing.
- **Time:** one tick is one 5 s game slot, and a person plays at most one game per tick. A run ends at `maxGamesPerPerson` ticks, or earlier when no legal challenge remains.

## Strategies (expected to grow)
- Add one `registerStrategy({ id, name, description, params, create })` block in `strategies.js`.
  - `create(params)` returns `{ init?, selectPairs(ctx), moveChooser? }`.
  - `ctx = { pop, rules, rng, tick, isActive(id), canChallenge(a, b) }`.
- The UI builds parameter controls from `params` automatically.
- The scheduler re-validates every proposed pair: pairs must be disjoint and pass `canChallenge`. Rejected pairs are counted in `history[].rejected`.
- `moveChooser(rng, history, personId, side)` is the hook for biased or adaptive RPS play.
- Only `random` ("Pairs are randomly chosen") exists so far.

## Look and feel
This page deploys next to **Central Limit Dice** (`~/src/central_limit_visualizer`, difficult-tech.com/central_limit_dice/) and must look like part of the same set.
- `style.css` starts with that project's tokens and components copied verbatim:
  - colours, the dark-mode pattern, 980px `main` and the single `@media (max-width: 720px)` breakpoint;
  - `.controls`, `.stat`, `.chart-card`, `.legend`, `.tooltip` and `.explain`.
- Game-specific rules come after the "Washburn Roshambo — game-specific styles" banner. Reuse sibling patterns; don't invent new ones.
- Game tokens: `--necklace-blue` (= `--series-1`), `--necklace-gold`, `--necklace-none`.
  - Gold is `#b8840f` light / `#bc8c20` dark. Both were validated with the dataviz palette validator (lightness band, CVD separation, ≥3:1 contrast). Re-validate if you change them.
- Population grid: one mark per person (circle = student, square = teacher).
  - Blue is a disk and gold is a ring drawn on top; gold-only holders get a solid gold mark.
  - Each colour is sized by its own count on one shared log₂ scale (`markRadius`). The scale runs from `MARK_MIN` (1 necklace) to `MARK_MAX` (every necklace in play).
  - `MARK_MAX = 0.75` cell caps neighbour overlap at ⅓ of a mark's width.
  - Bigger marks are re-appended so they draw on top.
  - An earlier version split one mark by area. Don't go back to it: small gold holdings disappeared under large blue ones.
- Charts: SVG with a fixed `viewBox` (800 wide, margins `{24,16,56,52}`), coloured only through CSS classes. Text uses text tokens, never series colours.

## Open items
- **Share/QR card:** not added yet. It needs the deploy URL slug; when known, add a `.share` card + `qr.svg` like the sibling's header.
- **Stage 4 extras (optional):** a "compare two rule sets with the same seed" mode, and a table view of the chart data.
- **"Show a game from this tick"** is disabled when a run ends early, because the final tick had no games.
- **Chart text on phones:** it gets small because the viewBox scales, the same as on the sibling page.
- The project isn't a git repository yet.
