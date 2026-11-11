# opencode-session-time

[![npm version](https://img.shields.io/npm/v/opencode-session-time)](https://www.npmjs.com/package/opencode-session-time)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Timestamps for your [OpenCode](https://opencode.ai) V2 sessions: a current-turn
stopwatch in the prompt footer, a `Session Timings` block in the sidebar, optional
relative ages, and a `/time` timeline popup.

> **v0.2.0–v0.2.1 contributed by [@ransagy](https://github.com/ransagy)** — last user
> input, last model thought and last model reply timings, relative ages, turn stopwatch,
> API backfill, durable persistence and throttled live refresh.

> **Fork note:** based on upstream `v0.3.2`. Upstream removed the ticking `x ago`
> labels in v0.3.2; this fork restores them as an opt-in `relativeAges` option,
> using minute+ granularity and boundary-scheduled updates instead of a 1-second
> sidebar repaint. Local-path loading is recommended because current OpenCode
> releases have a packaged-plugin reactivity bug (see [Install](#install)).

Small TUI plugin built on the official [`@opencode/plugin/tui`](https://opencode.ai/v2/docs/build/plugins/cli/) API.

## What you get

| Where | What |
| --- | --- |
| Prompt footer (`prompt.footer.status`) | current-turn elapsed time, `⏱ MM:SS` (or `⏱ H:MM:SS`). Starts when the first assistant step begins after the last user input and freezes when the turn completes. If that step is outside the loaded message window, it falls back to the last user input time. |
| Sidebar (`sidebar.content`) | `Session Timings` block styled like the built-in `Context`/`MCP` blocks: session start, last user input, last model thought, and last model reply. Each row shows a timestamp and the relevant duration; rows refresh on data events. With `relativeAges` enabled, each row also shows an age (`just now`, `3m ago`, …). Historical values are backfilled from the API when they are outside the loaded window. Rows are sorted oldest to newest; rows without a timestamp stay at the bottom. |
| `/time` command (palette popup) | assistant turn timeline as a searchable popup, newest first: time, agent, model, duration, reply preview. **Enter** opens a per-turn details card (timing, tokens, cost, finish reason); **Esc** returns to the list, **Esc** again closes. |

The sidebar block updates live on data events. Relative ages are off by default;
when enabled, the label changes only when the displayed unit changes (`just now` →
`1m ago` at 60s, then the next minute/hour/day/week/month/year boundary), so an
idle session does not repaint every second. The prompt-footer timer is a turn
stopwatch, not a wall clock; it shows `00:00` while waiting for the first assistant
step and `—` when there is no turn.

Per-session anchors are persisted in durable storage, so a TUI restart restores the
last input, thought, and reply immediately; the API backfill covers new sessions and
other devices.

Example with `relativeAges` enabled:

```text
Session Timings
16:27:31 started · 1d ago
17:43:12 input · 3m ago
17:43:20 thought · 2.1s · 3m ago
17:44:02 reply · 8.4s · 2m ago
```

Default (ages off):

```text
Session Timings
16:27:31 started
17:43:12 input
17:43:20 thought · 2.1s
17:44:02 reply · 8.4s
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
| `relativeAges` | `false` | Show minute-granularity relative ages in the sidebar. Labels update at the next displayed boundary, not every second. |

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
  per second; the footer stopwatch still ticks once per second while a turn runs.
- `/time` shows the timeline for the session you are currently in.
- The sidebar block uses `append`, so it appears after the built-in Context/MCP panels.
- Local-path plugin edits hot-reload; a packaged install is affected by the
  `node_modules` issue described under [Install](#install).

## License

MIT. Original work copyright (c) 2026 LazyGatto; see [LICENSE](LICENSE).
