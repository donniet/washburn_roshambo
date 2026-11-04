# Washburn Roshambo — bead necklace game simulator

A single-page browser simulator for a game played at a high school. Students start with **blue** necklaces and teachers with **gold** ones. The best-of-3 rock-paper-scissors winner takes necklace(s) from the loser. The finer rules are disputed, so the page lets you pick a rule set and challenge strategy and watch where the necklaces end up. Requirements live in [NOTES.md](NOTES.md).

Plain HTML/CSS/SVG/JS: ES modules, no build step, no dependencies.

## Commands
- **Serve:** `python3 -m http.server 8000` (or `npm run serve`), then open http://localhost:8000. ES modules don't load from `file://`.
- **Test:** `npm test` (= `node --test`, needs Node 20+).
  - Node isn't installed on this machine. To test here, run the `*.test.js` files in headless Chrome (`google-chrome --headless=new --dump-dom …`).
  - That needs a runner page with an import map pointing `node:test` and `node:assert/strict` at small shims. Keep the runner and shims in the scratchpad, not in the repo.
  - The scratchpad can be wiped between sessions, so be ready to recreate the harness. Give every helper page `<meta charset="utf-8">`, or curly quotes in the app's text won't match.

## Files
Keep the JS in these four files (the user asked for few files); each has a sibling `*.test.js`.

| File | Contents |
|---|---|
| `game.js` | Seeded RNG (mulberry32), Roshambo (`playMatch`), rules (`DEFAULT_RULES`, `RULE_OPTIONS`, `challengeError`/`canChallenge`, `isActive`, `transfer`), population (struct-of-arrays, ID = index), engine (`createGameState`, `resolveChallenge`). No DOM. |
| `strategies.js` | Strategy registry (`registerStrategy`, `listStrategies`, `getStrategy`), the built-in `random` strategy, and the scheduler (`createSimulation` → `step`/`run`/`history`). No DOM. |
| `game-view.js` | Match view, population dot grid, histogram and trend chart. DOM code runs only inside the create/render functions; pure helpers are exported and tested. |
| `main.js` | `readConfig(formValues)` (pure, tested) plus page wiring. Auto-inits only when `#setup` exists, so tests can import it. |

Dependencies go one way: `main.js` → `game-view.js` / `strategies.js` → `game.js`.

The "How it was made" page is separate from the simulator code:

| File | Contents |
|---|---|
| `making-of.html`, `making-of.js` (+ `making-of.test.js`) | Renders this Claude Code conversation for students, styled like Claude Code: your messages, Claude's replies (a small, tested, HTML-escaping Markdown renderer), and collapsible tool-call rows with lazy-built input/output and screenshots. Relative file links in replies point at GitHub (`resolveLink`). |
| `tools/build_making_of.py` | Builds `making-of/transcript.json` + `making-of/img/*` from the session `.jsonl`. |
| `making-of/` | Generated data. Re-run the builder to refresh; don't hand-edit. |

- **Refresh** after more conversation: `python3 tools/build_making_of.py ~/.claude/projects/-home-donniet-src-washburn-bead-necklace-game-simulator/<session>.jsonl`.
- **The builder keeps only the visible conversation:** user messages (including mid-turn `queued_command` ones), Claude's text, tool calls and results, and screenshots.
- **It drops:** Claude's private reasoning, system reminders and internal records.
- **It cleans:** it removes email addresses, shortens `$HOME` to `~` and temp folders to `scratchpad` / `/tmp/claude/`, and clips long text at 3,000 characters.
- **Don't comb through the transcript's internal (non-message) records when working on this.** An automatic safety check stopped that once.
- The main page's footer links to `making-of.html` and to GitHub.

## Model and rules
- **Population:** typed arrays `role` (0 student / 1 staff), `blue`, `gold`, `gamesPlayed`, `slotsUsed`, `declines`, `declinedAgainst`, and `strategyId`.
  - `slotsUsed` counts games plus declines on either side; it's what the per-person time limit checks.
  - `declines` is how often this person declined; `declinedAgainst` is how often their own challenges were declined.
  - `strategyId` is reserved for per-person strategies.
  - Students are IDs `0…numStudents-1`; staff follow.
- **Dealing necklaces:** if there are fewer necklaces than people, they go to a random (seeded) subset of the group. Extras are dealt randomly within the group. An empty group gets none.
- **Rule variations** (in `RULE_OPTIONS`; the UI builds its radio groups from it):
  - `transfer`: `all` | `oneRandom` (default; weighted by the loser's counts) | `goldFirst` | `blueFirst`;
  - `teachersTakeFromStudents`: boolean, default `true`. It's a checkbox under "What the winner takes", declared as a `toggles` entry on the `transfer` group.
    - When `false`, a teacher who beats a student takes nothing: `transferBlocked` → `'teachersCantTake'`, and the event carries `blocked`. The game still counts and uses the slot.
    - Students can still take from teachers (confirmed with the user).
    - Checkboxes reach `readConfig` as `'yes'`/`'no'`, because `formValues` spells them out (unchecked boxes are missing from `FormData`). Any other value keeps the default.
  - `staffVsStudent`: `allowed` | `studentsMayChallengeStaff` | `never`. Challenges are *directed*;
  - `staffVsStaff`: `allowed` | `never`;
  - `zeroNecklaces`: `out` | `canChallenge`;
  - `declining`: `never` (default) | `allowed`. This is permission only; the strategy decides *when* a student declines. The group has a `note` that the UI shows under it;
  - `maxGamesPerPerson`: shown in the UI as "Time slots per person", default **300**. 25 min ÷ 5 s = 300; NOTES.md's "1500" was an arithmetic slip.
- **Decisions confirmed with the user:**
  - The winner takes from the loser.
  - Ties are replayed and don't count. After 50 rounds, a coin flip decides.
  - A target must hold at least 1 necklace.
  - A zero-necklace challenger who loses gives nothing.
- **Declines** (confirmed with the user):
  - Only students may decline; teachers always accept.
  - The rule is allowed/not allowed; the conditions (challenger has MORE/LESS, coin flip) live in the strategy's `declineBy` and compare total necklaces strictly, so a tie means no decline.
  - The user asked for this split. An earlier version had fewer/more conditions in the rule too, which duplicated the strategy.
  - A decline uses one time slot for both people and moves nothing. There's no limit on declines; their effect is shown in charts instead.
  - `declineError`/`canDecline` decide whether a decline is allowed.
  - `resolveChallenge(state, c, t, { respond })` returns one of three results: `ok: false` (not allowed), `outcome: 'declined'` or `outcome: 'played'`.
  - `respond` is only consulted when a decline is allowed.
- **Time:** one tick is one 5 s slot, and a person plays or declines at most once per tick.
- **End of a run:** `sim.endReason` is one of:
  - `{ reason: 'time' }`;
  - `{ reason: 'oneHolder', holder, total }`;
  - `{ reason: 'stuck', holders }`, meaning necklaces are spread out but no legal challenge is left.

  `endMessage(sim)` in `main.js` turns it into the status text. Under "zero necklaces OUT" it also suggests "CAN still challenge".
  - With "winner takes all" + "OUT", one person ends up with everything within tens of ticks. Stopping then is correct, not a bug (confirmed with the user's report). A run ends at `maxGamesPerPerson` ticks, or earlier when no legal challenge remains.

## Strategies (expected to grow)
- Add one `registerStrategy({ id, name, description, params, create })` block in `strategies.js`.
  - `create(params)` returns `{ init?, selectPairs(ctx), respond?, moveChooser? }`.
    - `respond(ctx, challenger, target)` is the *target's* choice: `'accept'` or `'decline'`.
  - `ctx = { pop, rules, rng, tick, isActive(id), canChallenge(a, b), canDecline(a, b) }`.
- The UI builds parameter controls from `params` automatically.
- The scheduler re-validates every proposed pair: pairs must be disjoint and pass `canChallenge`. Rejected pairs are counted in `history[].rejected`.
- `moveChooser(rng, history, personId, side)` is the hook for biased or adaptive RPS play.
- Param types: `range`, `number` and `select` (`options: [{ value, label }]`). `main.js` builds the matching control, and `readConfig` validates each type.
- Any param may set `enabledWhen(rules)` + `disabledHint`.
  - `main.js` (`updateParamStates`, run on every reset) greys it out and shows the hint when it's irrelevant. Disabled controls keep their value, and `FormData` skips them, so the default is used.
  - Both decline settings (`classroom.declineBy`, `random.declineRate`) are enabled only when `rules.declining === 'allowed'`.
- `classroom`, "Students choose from a classroom", is the default (`DEFAULT_STRATEGY`). A strategy is a combination of two options:
  - `challengeBy`: `random` | `highest` | `lowest`;
  - `declineBy`: `never` | `ifMore` | `ifLess` | `coin`;
  - plus `groupSize` (default 30).
- How `classroom` works each tick:
  1. Active people are shuffled.
  2. Each unpaired person samples `groupSize` random ids (`sampleGroup`) and keeps those still unpaired whom they may challenge.
  3. They pick a target by score (total necklaces) using `CHALLENGE_PICKERS`. Ties go to whoever appears first in the random sample.
  4. `respond` applies `DECLINE_CHOICES`. It's only consulted when the rules allow a decline.
  - Teachers use the same challenge option but always accept.
- `random`, "Pairs are randomly chosen", is kept for comparison. Its params are `participation` and `declineRate`.
- On hold (user likes it, may return): give each student a fixed declining *tendency*, and group the decline chart by it to remove survivorship bias.

## Look and feel
This page deploys next to **Central Limit Dice** (`~/src/central_limit_visualizer`, difficult-tech.com/central_limit_dice/) and must look like part of the same set.
- `style.css` starts with that project's tokens and components copied verbatim:
  - colours, the dark-mode pattern, 980px `main` and the single `@media (max-width: 720px)` breakpoint;
  - `.controls`, `.stat`, `.chart-card`, `.legend`, `.tooltip` and `.explain`.
- Game-specific rules come after the "Washburn Roshambo — game-specific styles" banner. Reuse sibling patterns; don't invent new ones.
- Game tokens: `--necklace-blue` (= `--series-1`), `--necklace-gold`, `--necklace-none`, `--role-student` (aqua `#1baf7a` / `#199e70`), `--role-staff` (= `--text-secondary`, a neutral).
  - Teachers are deliberately neutral: no fourth hue passed the colourblindness check against blue + gold + aqua (violet ≈ blue, orange/red ≈ gold). Use role colours only where blue/gold mean necklaces elsewhere on the page.
  - Gold is `#b8840f` light / `#bc8c20` dark. Both were validated with the dataviz palette validator (lightness band, CVD separation, ≥3:1 contrast). Re-validate if you change them.
- Population grid: one mark per person (circle = student, square = teacher).
  - Blue is a disk and gold is a ring drawn on top; gold-only holders get a solid gold mark.
  - Each colour is sized by its own count on one shared log₂ scale (`markRadius`). The scale runs from `MARK_MIN` (1 necklace) to `MARK_MAX` (every necklace in play).
  - Sizes (fraction of a cell): `MARK_EMPTY = 0.2`, `MARK_MIN = 0.42` (single-necklace marks don't touch), `MARK_MAX = 1`. The maximum lets neighbours overlap by up to half a mark's width (the user raised this from ⅓).
  - Bigger marks are re-appended so they draw on top.
  - An earlier version split one mark by area. Don't go back to it: small gold holdings disappeared under large blue ones.
- Hand emoji are grayscale with their finger detail kept. `.glyph { filter: var(--hand-filter) }` uses a per-theme token:
  - light: `grayscale(1) brightness(0.55) contrast(1.8)` (charcoal);
  - dark: `grayscale(1) brightness(1.1) contrast(1.2)` (light grey).
  - The glyph sits in an inner span (`handEl`) because a filter on `.hand` would also grey out the blue win highlight.
  - Rejected: text-shadow silhouette (loses detail) and U+FE0E (inconsistent).
- Histogram ("by role"): stacked bars. X = total necklaces per person (0, then doubling bins 1, 2, 3–4 …); y = people; students on the bottom, teachers on top.
  - Segments have a 2px surface gap, and totals are labelled above each bar.
  - Includes a 0 bin (people holding nothing), which the user asked for; it dominates late in a run, so bar totals are labelled.
  - Helper: `roleHistogram(pop)`.
- Histogram ("by colour"), the card after it: grouped blue/gold bars side by side.
  - X = necklaces of one colour per person; y = people.
  - Someone holding both colours is counted in each.
  - Helper: `colorHistogram(pop)`.
- "Does declining pay off?" chart (`declinePayoff`):
  - Students are grouped by *decline rate* = `declines / declineChances`. `declineChances` counts challenges where the rules let them decline, whether or not they did.
  - Bins: 0%, 1–24%, 25–49%, 50–74%, 75–99%, 100%. Bar = average necklaces held now.
  - Students with no chances are reported in the note; teachers are excluded.
  - Known bias: extreme rates come mostly from students with only 1–2 chances (early losers). So even a coin-flip strategy doesn't give flat bars.
  - Grouping by an assigned per-student tendency (from a strategy) would avoid this.
- "Over time" also plots the % of each tick's challenges that were declined (aqua line).
- The "Challenges declined" stat tile replaced "Blue / gold in play"; that total now sits in the "Most held" tile's sub-line.
- Broken y-axis (user request) on all three bar charts, via `axisScale(values, { top, bottom, minRatio = 4 })` + `drawBreak`:
  - When the biggest jump between neighbouring bar heights is ≥4×, the lower 66% of the plot shows 0…the small bars, a 22px band with two zig-zag lines skips the middle, and the top shows only the range around the tall bars.
  - The edge ticks next to the band are omitted.
  - If no clean split exists, the axis falls back to a plain, unbroken scale.
  - Stacked segments must use cumulative values with `y()` (never scale segment heights separately), or they distort across the break.
  - Every bar carries its value label, because heights aren't comparable across the break.
- Charts: SVG with a fixed `viewBox` (800 wide, margins `{24,16,56,52}`), coloured only through CSS classes. Text uses text tokens, never series colours.

## CSV downloads
- Every visualization card has a "⤓ CSV" link (`a.csv-link[data-csv]`) beside its title, inside `.chart-title`.
- `main.js` builds the file on click from the current run: a Blob with a UTF-8 BOM (for Excel), named `washburn-roshambo_<card>_seed-<slug>_tick-<n>.csv`.
- Pure row builders live in `game-view.js` (`toCsv` with RFC 4180 quoting):
  - `populationRows`: `Person` 1…N, `Role`, `Blue_Necklaces`, `Gold_Necklaces`, as the user specified;
  - `roleHistogramRows`, `colorHistogramRows` and `declineRows`: one row per plotted bar;
  - `trendRows`: one row per tick, with the plotted percentages plus the raw counts behind them.
- A new chart should get a `data-csv` key, a `*Rows` builder and an entry in `CSV_SOURCES`.

## Deployment
- URL: https://difficult-tech.com/washburn_roshambo/ (next to /central_limit_dice/).
- The header `.share` card links there, and `qr.svg` encodes it.
- `qr.svg` was generated with segno to match the sibling exactly (version 4, error level Q, white background, viewBox, no size):
  `segno.make(url, error='Q', micro=False).save('qr.svg', kind='svg', light='#fff', title=f'QR code: {url}', xmldecl=False, omitsize=True, nl=True)`.
  These settings reproduce the sibling's `qr.svg` byte for byte. segno isn't installed system-wide; install it into the scratchpad with `pip install --target`.

## Open items
- **Stage 4 extras (optional):** a "compare two rule sets with the same seed" mode, and a table view of the chart data.
- **"Show a game from this tick"** is disabled when a run ends early, because the final tick had no games.
- **Chart text on phones:** it gets small because the viewBox scales, the same as on the sibling page.
- Repo: https://github.com/donniet/washburn_roshambo (branch `main`). The user makes the commits.
