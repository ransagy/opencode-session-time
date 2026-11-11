# opencode-session-time

[![npm version](https://img.shields.io/npm/v/opencode-session-time)](https://www.npmjs.com/package/opencode-session-time)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Timestamps for your [OpenCode](https://opencode.ai) V2 sessions: a current-turn
stopwatch, a collapsible `Session` / `Last answer` sidebar block, optional relative
ages, and a `/time` timeline popup.

> **v0.2.0–v0.2.1 contributed by [@ransagy](https://github.com/ransagy)** — last user
> input, last model thought and last model reply timings, relative ages, turn stopwatch,
> API backfill, durable persistence and throttled live refresh.

> **Fork note:** based on upstream `v0.4.0`. Upstream removed the ticking `x ago`
> labels in v0.3.2; this fork restores them as an opt-in `relativeAges` option,
> appended to the sidebar labels with minute+ granularity and boundary-scheduled
> updates. Local-path loading is recommended because current OpenCode releases
> have a packaged-plugin reactivity bug (see [Install](#install)).

Small TUI plugin built on the official [`@opencode/plugin/tui`](https://opencode.ai/v2/docs/build/plugins/cli/) API.

## What you get

| Where | What |
| --- | --- |
| Prompt footer (`prompt.footer.status`) | current-turn elapsed time, `⏱ MM:SS` (or `⏱ H:MM:SS`). Starts when the first assistant step begins after the last user input and freezes when the turn completes. If that step is outside the loaded message window, it falls back to the last user input time. |
| Sidebar (`sidebar.content`) | Collapsible `Session` block (start time, request/step counters) and `Last answer` block (user input, thought phases ×N + total duration, reply + duration, tool/MCP totals and top tools). Rows refresh on data events. With `relativeAges` enabled, timestamped rows also show an age (`just now`, `3m ago`, …) appended to the label. |
| `/time` command (palette popup) | assistant turn timeline as a searchable popup, newest first: time, agent, model, duration, reply preview. **Enter** opens a per-turn details card (timing, tokens, cost, finish reason); **Esc** returns to the list, **Esc** again closes. |

The sidebar block updates live on data events. Relative ages are off by default;
when enabled, the label changes only when the displayed unit changes (`just now` →
`1m ago` at 60s, then the next minute/hour/day/week/month/year boundary), so an
idle session does not repaint every second. Collapsing the `Session` block stops
the age timer. The prompt-footer timer is a turn stopwatch, not a wall clock; it
shows `00:00` while waiting for the first assistant step and `—` when there is no
turn.

Per-session anchors are persisted in durable storage, so a TUI restart restores the
last input, thought, and reply immediately; the API backfill covers new sessions and
other devices.

Example with `relativeAges` enabled:

```text
▼ Session
  • Started · 10m ago                    24.10, 17:27:41
  • Requests 12 · Steps 34
  Last answer  ⏱
    • User · 5m ago                      20:50:05
    • Thought ×3 · 12.4s · 2m ago        20:55:27
    • Reply · 8.4s · 1m ago              20:55:29
    • Tools 4 · shell 2 · read 1 · edit 1
```

Default (ages off):

```text
▼ Session
  • Started                              24.10, 17:27:41
  • Requests 12 · Steps 34
  Last answer  ⏱
    • User                               20:50:05
    • Thought ×3 · 12.4s                 20:55:27
    • Reply · 8.4s                       20:55:29
    • Tools 4 · shell 2 · read 1 · edit 1
```

Same-day timestamps omit the date. Older timestamps include it (`23.10, 16:27:31`).

The prompt footer shows the current-turn stopwatch:

```text
⏱ 03:12
```

## Why the sidebar and not under each message?

The plugin API exposes slots for `app`, `home.footer*`, `prompt.footer*`,
`session.composer.top`, `sidebar.*` and `session.panel` — but there is **no slot for
the per-message footer**, and no settings option for it either. Inline per-message
timestamps would need an upstream `message.footer` slot. Until then, the sidebar block
is the closest native place.

## Options

Plugin options are passed through `cli.json`:

| Option | Default | Meaning |
| --- | --- | --- |
| `relativeAges` | `false` | Show minute-granularity ages on timestamped sidebar rows. Labels update at the next displayed boundary, not every second. |

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-session-time",
      "options": { "relativeAges": true }
    }
  ]
}
```

## Install

TUI-only plugin. For this fork, load it from an absolute path outside `node_modules`:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-session-time",
      "options": { "relativeAges": true }
    }
  ]
}
```

Restart the TUI after changing the plugin entry. The local path matters: current
OpenCode releases do not apply the host Solid JSX transform to TSX under
`node_modules`, so an npm-installed copy can paint its first frame and then never
update (`anomalyco/opencode#39986`). Loading by absolute path keeps the plugin on
the host runtime, so the stopwatch and boundary-scheduled ages stay live.

The upstream package is published as `opencode-session-time`. The npm install path
is kept for reference, but expect the packaged-plugin freeze until the upstream
loader is fixed:

```bash
opencode plugin add opencode-session-time
```

Requirements: OpenCode V2; `@opentui/core`, `@opentui/solid`, `solid-js` are peer
dependencies provided by the host. This is a terminal-client plugin; web and desktop
clients do not load TUI plugins.

## Notes

- With `relativeAges` enabled, ages update at the next displayed boundary, not once
  per second; collapsing the `Session` block stops the timer. The footer stopwatch
  still ticks once per second while a turn runs.
- `/time` shows the timeline for the session you are currently in.
- The sidebar block uses `append`, so it appears after the built-in Context/MCP panels.
- Local-path plugin edits hot-reload; a packaged install is affected by the
  `node_modules` issue described under [Install](#install).

## License

MIT. Original work copyright (c) 2026 LazyGatto; see [LICENSE](LICENSE).
