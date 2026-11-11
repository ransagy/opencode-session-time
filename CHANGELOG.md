# Changelog

## Unreleased (fork)

- Add opt-in `relativeAges` sidebar option (default off). Minute-granularity ages:
  `just now` under 60s, then minutes/hours/days/weeks/months/years. Labels update at
  the next displayed boundary through a single timeout instead of a 1-second sidebar
  repaint; the footer stopwatch remains 1s.
- Keep absolute timestamps and durations next to the ages; ages are additive.
- Preserve v0.3.2's data-event-only sidebar when `relativeAges` is off.
- Document that current OpenCode packaged/npm TUI plugins can freeze because the host
  does not apply its Solid JSX transform under `node_modules`
  (`anomalyco/opencode#39986`); an absolute local path is the workaround.

## 0.3.2 — 2026-11-11

- Sidebar `Session Timings` again shows plain timestamps/durations refreshed on data events.
  The ticking `x ago` ages are removed: the TUI repaints on activity, not every second
  while idle, so live ages froze and misled.

## 0.3.1 — 2026-11-11

- Clicking the prompt-footer timer opens the `/time` timeline popup (the popup itself is mouse-friendly: click, scroll).
- Reset the prompt-footer stopwatch to `00:00` when a new user message is waiting for its first
  assistant step, instead of continuing the previous turn's value. (contributed by [@ransagy](https://github.com/ransagy))
- Package metadata points back at the upstream repository. (contributed by [@ransagy](https://github.com/ransagy))

## 0.3.0 — 2026-11-08

- `/time` is now a palette-style popup (`dialog.select`): searchable timeline with the
  newest turns first, `ctrl+n`/`ctrl+p` navigation, `ctrl+a` to close. Replaces the
  session panel.
- Each timeline row previews the text reply. **Enter** opens a per-turn details card
  (timing, agent, model, tokens, cost, finish reason, reply preview); **Esc** returns
  to the timeline, **Esc** again closes it.
- `xlarge` + `centered` dialog presentation for both popups.

## 0.2.2 — 2026-11-08

- `/time` is now a toggle: a repeated command closes the panel
  (`context.ui.panel.current()` + `panel.close()`).

## 0.2.1 — 2026-10-27

- Sort `Session Timings` rows oldest to newest so the sidebar always shows the
  sequence of events; rows without a timestamp stay at the bottom.

## 0.2.0 — 2026-10-24

- Rename the sidebar block to `Session Timings`.
- Show session start, last user input, last model thought, and last model reply.
- Add relative ages (`just now`, `3m ago`, `2d ago`) that refresh every second.
- Add seconds to timestamps; same-day timestamps omit the date.
- Show thought and reply durations in the sidebar.
- Prompt footer now shows current-turn elapsed time (`⏱ MM:SS`), anchored to the first
  assistant step after the last user input and frozen when the turn completes. Falls
  back to the last user input time when the turn start is outside the loaded window.
- Backfill last user input, last text reply, and last thought from the API when they
  are outside the loaded message window; long tool-only runs no longer show `—`.
- Persist per-session timestamps in durable storage so the sidebar survives TUI
  restarts and crashes.
- Make live refresh event-driven with a 1s minimum interval, a 5s running fallback,
  and a final idle sync.
- `/time` panel now lists assistant turns only and includes turn durations.

## 0.1.1 — 2026-10-11

- Fix: explicit `@jsxImportSource @opentui/solid` (pragma + tsconfig) — the plugin loader
  compiles published packages with the React JSX runtime by default, which broke loading.
## 0.1.0 — 2026-10-11

- Wall clock in the prompt footer (`prompt.footer.status`).
- Sidebar block `Session`: `DD.MM, HH:mm started` / `DD.MM, HH:mm last answer`
  (`sidebar.content`, updates on data events).
- `/time` command: timeline panel with every turn's start/end time, agent and model.
