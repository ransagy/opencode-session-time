# Changelog

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
