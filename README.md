# opencode-session-time

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Timestamps for your [OpenCode](https://opencode.ai) V2 sessions: a wall clock in the
prompt footer, a `Session Timings` block in the sidebar, and a `/time` timeline panel.

> This is a fork of
> [LazyGatto/opencode-session-time](https://github.com/LazyGatto/opencode-session-time)
> that adds last user input, last model thought, and last model reply timings, plus
> relative ages.

Small TUI plugin built on the official [`@opencode/plugin/tui`](https://opencode.ai/v2/docs/build/plugins/cli/) API.

## What you get

| Where | What |
| --- | --- |
| Prompt footer (`prompt.footer.status`) | wall clock, `HH:mm:ss`, refreshes every second |
| Sidebar (`sidebar.content`) | `Session Timings` block styled like the built-in `Context`/`MCP` blocks: session start, last user input, last model thought, and last model reply. Each row shows a timestamp, relevant duration, and `x ago` age. |
| `/time` command (session panel) | assistant turn timeline: start time, agent, model, completion time, and duration |

The sidebar block updates live on data events, and relative ages refresh every second.

Example:

```text
Session Timings
16:27:31 started · 1d ago
17:43:12 input · 3m ago
17:43:20 thought · 2.1s · 3m ago
17:44:02 reply · 8.4s · 2m ago
```

Same-day timestamps omit the date. Older timestamps include it (`23.10, 16:27:31`).

## Why the sidebar and not under each message?

The plugin API exposes slots for `app`, `home.footer*`, `prompt.footer*`,
`session.composer.top`, `sidebar.*` and `session.panel` — but there is **no slot for
the per-message footer**, and no settings option for it either. Inline per-message
timestamps would need an upstream `message.footer` slot. Until then, the sidebar block
is the closest native place.

## Install

From this fork's GitHub repository:

```bash
opencode plugin add github:ransagy/opencode-session-time
```

Or configure it manually in `~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": ["github:ransagy/opencode-session-time"]
}
```

Requirements: OpenCode V2; `@opentui/core`, `@opentui/solid`, `solid-js` are peer
dependencies provided by the host.

## Notes

- `/time` shows the timeline for the session you are currently in.
- The sidebar block uses `append`, so it appears after the built-in Context/MCP panels.
- Plugin edits hot-reload: the plugin is rebuilt on reconciliation, no TUI restart needed.

## License

MIT. Original work copyright (c) 2026 LazyGatto; see [LICENSE](LICENSE).
