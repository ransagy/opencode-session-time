/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"

// opencode-session-time: timestamps for your OpenCode sessions.
//
//  - prompt.footer.status — elapsed time for the current turn near the prompt;
//  - sidebar.content      — a "Session Timings" block (started / input / thought / reply);
//  - session.panel        — a /time command with the per-turn timeline.
//
// Note: the OpenCode plugin API has no slot for the per-message footer, so
// inline timestamps under each message are not possible yet (upstream feature
// request: a `message.footer` slot).

const pad = (n: number) => String(n).padStart(2, "0")

const stopwatch = (ms?: number) => {
  if (ms === undefined || ms < 0) return "—"
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

const fmt = (ms?: number) => {
  if (!ms) return "—"
  const d = new Date(ms)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  if (d.toDateString() === new Date().toDateString()) return time
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}, ${time}`
}

const dur = (start?: number, end?: number) => {
  if (!start || !end || end < start) return undefined
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  if (minutes < 60) return `${minutes}m${pad(seconds)}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${pad(minutes % 60)}m`
  return `${Math.floor(hours / 24)}d${pad(hours % 24)}h`
}

const ago = (ms?: number) => {
  if (!ms) return ""
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const line = (ms: number | undefined, label: string, duration?: string) => {
  if (!ms) return `— ${label}`
  return `${fmt(ms)} ${label}${duration ? ` · ${duration}` : ""} · ${ago(ms)}`
}

const messages = (context: any, sessionID: string): any[] =>
  (context.data.session.message.list(sessionID) ?? []) as any[]

const currentTurn = (list: any[]) => {
  let lastAssistant = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === "assistant" && list[i].time?.created) {
      lastAssistant = i
      break
    }
  }

  let lastUser = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === "user") {
      lastUser = i
      break
    }
  }

  if (lastAssistant < 0) {
    return lastUser >= 0 ? { waiting: true } : undefined
  }

  let user = -1
  for (let i = lastAssistant - 1; i >= 0; i--) {
    if (list[i].type === "user") {
      user = i
      break
    }
  }
  if (user < 0) return undefined

  const turn = list
    .slice(user + 1, lastAssistant + 1)
    .filter((message) => message.type === "assistant" && message.time?.created)
  if (turn.length === 0) return undefined

  const first = turn[0]
  const last = turn[turn.length - 1]
  let lastActivity = first.time.created as number
  for (const message of turn) {
    lastActivity = Math.max(
      lastActivity,
      message.time?.created ?? 0,
      message.time?.streamed ?? 0,
      message.time?.completed ?? 0,
    )
    for (const part of message.content ?? []) {
      if (!part.time) continue
      lastActivity = Math.max(
        lastActivity,
        part.time.created ?? 0,
        part.time.ran ?? 0,
        part.time.completed ?? 0,
      )
    }
  }

  return {
    start: first.time.created as number,
    last: lastActivity,
    completed: last.time?.completed !== undefined,
  }
}

const lastUser = (list: any[]) => {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === "user") return list[i]
  }
}

const lastThought = (list: any[]) => {
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i]
    if (message.type !== "assistant" || !Array.isArray(message.content)) continue
    for (let j = message.content.length - 1; j >= 0; j--) {
      const part = message.content[j]
      if (part.type === "reasoning" && part.time?.created) return part
    }
  }
}

const lastReply = (list: any[]) => {
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i]
    if (message.type !== "assistant" || !message.time?.completed) continue
    if (message.content?.some((part: any) => part.type === "text" && part.text?.trim())) return message
  }
}

export default Plugin.define({
  id: "session-time",
  setup(context) {
    // One tick drives every slot: any data event re-renders, plus a 1s timer for the stopwatch and ages.
    const [tick, setTick] = createSignal(0)
    const bump = () => setTick((t) => t + 1)

    let dirty = true
    let wasRunning = false
    let syncing = false
    const unlisten = context.data.listen(() => {
      dirty = true
      bump()
    })

    const refresh = () => {
      const route = context.ui.router.current()
      const sessionID = route.type === "session" ? (route.sessionID as string) : undefined
      if (!sessionID) {
        bump()
        return
      }

      const running = context.data.session.status(sessionID) === "running"
      const shouldSync = running || wasRunning || dirty
      wasRunning = running
      if (!shouldSync || syncing) {
        bump()
        return
      }

      dirty = false
      syncing = true
      Promise.allSettled([
        context.data.session.sync(sessionID),
        context.data.session.message.sync(sessionID),
      ]).finally(() => {
        syncing = false
        bump()
      })
    }

    const timer = setInterval(refresh, 1_000)
    refresh()

    // 1) Current-turn elapsed time in the prompt footer.
    const PromptClock = () => {
      const elapsed = createMemo(() => {
        tick()
        const route = context.ui.router.current()
        const sessionID = route.type === "session" ? (route.sessionID as string) : undefined
        if (!sessionID) return "—"

        const turn = currentTurn(messages(context, sessionID))
        if (!turn) return "—"
        if ("waiting" in turn) return "00:00"

        const status = context.data.session.status(sessionID)
        const running = status === "running" || (status === undefined && !turn.completed)
        return stopwatch((running ? Date.now() : turn.last) - turn.start)
      })

      return <text fg={context.theme.text.muted} content={`⏱ ${elapsed()}`} />
    }

    // 2) "Session Timings" block in the sidebar (styled like the built-in Context/MCP blocks).
    const SessionTimings = (props: { sessionID: string }) => {
      const rows = createMemo(() => {
        tick()
        const list = messages(context, props.sessionID)
        const session = context.data.session.get(props.sessionID)
        const input = lastUser(list)
        const thought = lastThought(list)
        const reply = lastReply(list)
        return {
          started: line(session?.time?.created, "started"),
          input: line(input?.time?.created, "input"),
          thought: line(
            thought?.time?.created,
            "thought",
            dur(thought?.time?.created, thought?.time?.completed),
          ),
          reply: line(
            reply?.time?.completed,
            "reply",
            dur(reply?.time?.created, reply?.time?.completed),
          ),
        }
      })

      return (
        <box flexDirection="column">
          <text fg={context.theme.text.base} attributes={TextAttributes.BOLD}>Session Timings</text>
          <text fg={context.theme.text.muted} content={rows().started} />
          <text fg={context.theme.text.muted} content={rows().input} />
          <text fg={context.theme.text.muted} content={rows().thought} />
          <text fg={context.theme.text.muted} content={rows().reply} />
        </box>
      )
    }

    // 3) /time — per-turn timeline panel.
    const Timeline = () => {
      const rows = createMemo(() => {
        tick()
        const route = context.ui.router.current()
        const sessionID = route.type === "session" ? (route.sessionID as string) : undefined
        return sessionID
          ? messages(context, sessionID).filter((message) => message.type === "assistant")
          : []
      })

      return (
        <box flexDirection="column">
          <text fg={context.theme.text.base} attributes={TextAttributes.BOLD}>Timeline</text>
          <For each={rows()}>
            {(message: any) => {
              const duration = dur(message.time?.created, message.time?.completed)
              return (
                <text fg={context.theme.text.muted}>
                  {fmt(message.time?.created)} · {message.agent ?? "—"} ·{" "}
                  {message.model?.id ?? message.model ?? "—"} →{" "}
                  {message.time?.completed
                    ? `${fmt(message.time.completed)}${duration ? ` · ${duration}` : ""}`
                    : "in progress"}
                </text>
              )
            }}
          </For>
          <Show when={rows().length === 0}>
            <text fg={context.theme.text.muted}>No assistant turns yet</text>
          </Show>
        </box>
      )
    }

    const disposeClock = context.ui.slot({
      append: "prompt.footer.status",
      render: () => <PromptClock />,
    })

    const disposeSide = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <SessionTimings sessionID={sessionID} />,
    })

    const disposePanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === "session-time.timeline"}>
          <Timeline />
        </Show>
      ),
    })

    // Keymap provider exists only in a full TUI; CLI reconciliation must not fail.
    let disposeKeys: (() => void) | undefined
    try {
      disposeKeys = context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: "session-time.timeline",
            title: "Time: session timeline",
            slash: { name: "time" },
            run: () => {
              context.ui.panel.open("session-time.timeline")
            },
          },
        ],
      }))
    } catch {
      // no Keymap.Provider outside the TUI — the command is simply not registered
    }

    return () => {
      clearInterval(timer)
      unlisten()
      disposeClock?.()
      disposeSide?.()
      disposePanel?.()
      disposeKeys?.()
    }
  },
})
