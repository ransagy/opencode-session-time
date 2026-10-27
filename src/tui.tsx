/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
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

const activity = (message: any) => {
  let last = message.time?.created ?? 0
  last = Math.max(last, message.time?.streamed ?? 0, message.time?.completed ?? 0)
  for (const part of message.content ?? []) {
    if (!part.time) continue
    last = Math.max(
      last,
      part.time.created ?? 0,
      part.time.ran ?? 0,
      part.time.completed ?? 0,
    )
  }
  return last
}

const currentTurn = (list: any[], fallbackUser?: number) => {
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
    return lastUser >= 0 || fallbackUser ? { waiting: true } : undefined
  }

  let user = -1
  for (let i = lastAssistant - 1; i >= 0; i--) {
    if (list[i].type === "user") {
      user = i
      break
    }
  }

  if (user < 0) {
    if (!fallbackUser) return undefined
    let lastActivity = 0
    for (const message of list) {
      if (message.type !== "assistant") continue
      lastActivity = Math.max(lastActivity, activity(message))
    }
    if (lastActivity < fallbackUser) return { waiting: true }
    return {
      start: fallbackUser,
      last: lastActivity,
      completed: list[lastAssistant].time?.completed !== undefined,
    }
  }

  const turn = list
    .slice(user + 1, lastAssistant + 1)
    .filter((message) => message.type === "assistant" && message.time?.created)
  if (turn.length === 0) return undefined

  const first = turn[0]
  const last = turn[turn.length - 1]
  let lastActivity = first.time.created as number
  for (const message of turn) {
    lastActivity = Math.max(lastActivity, activity(message))
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

type Anchor = {
  user?: number
  thought?: number
  thoughtDuration?: string
  reply?: number
  replyDuration?: string
  updated?: number
}

type AnchorStore = Record<string, Anchor>

type TimingKey = "started" | "input" | "thought" | "reply"

type TimingValue = {
  at?: number
  text: string
  rank: number
}

type TimingValues = Record<TimingKey, TimingValue>

const mergeAnchor = (current: Anchor, patch: Anchor): Anchor | undefined => {
  const next: Anchor = { ...current }
  let changed = false

  if (patch.user !== undefined && patch.user > (current.user ?? 0)) {
    next.user = patch.user
    changed = true
  }
  if (patch.thought !== undefined && patch.thought >= (current.thought ?? 0)) {
    if (patch.thought !== current.thought || patch.thoughtDuration !== current.thoughtDuration) {
      next.thought = patch.thought
      next.thoughtDuration = patch.thoughtDuration
      changed = true
    }
  }
  if (patch.reply !== undefined && patch.reply >= (current.reply ?? 0)) {
    if (patch.reply !== current.reply || patch.replyDuration !== current.replyDuration) {
      next.reply = patch.reply
      next.replyDuration = patch.replyDuration
      changed = true
    }
  }
  if (patch.updated !== undefined && patch.updated > (current.updated ?? 0)) {
    next.updated = patch.updated
    changed = true
  }
  return changed ? next : undefined
}

export default Plugin.define({
  id: "session-time",
  setup(context) {
    // One tick drives every slot: any data event re-renders, plus a 1s timer for the stopwatch and ages.
    const [tick, setTick] = createSignal(0)
    const bump = () => setTick((t) => t + 1)

    const [anchors, updateAnchors] = context.storage.store<AnchorStore>("session-timings-v1", {
      initial: {},
    })

    const remember = (sessionID: string, patch: Anchor) => {
      if (!mergeAnchor(anchors[sessionID] ?? {}, patch)) return
      void updateAnchors((draft) => {
        const next = mergeAnchor(draft[sessionID] ?? {}, patch)
        if (next) draft[sessionID] = next
      }).catch(() => {})
    }

    const rememberFromList = (sessionID: string) => {
      const list = messages(context, sessionID)
      const user = lastUser(list)
      const thought = lastThought(list)
      const reply = lastReply(list)
      const patch: Anchor = {}
      if (user?.time?.created) patch.user = user.time.created
      if (thought?.time?.created) {
        patch.thought = thought.time.created
        patch.thoughtDuration = dur(thought.time?.created, thought.time?.completed)
      }
      if (reply?.time?.completed) {
        patch.reply = reply.time.completed
        patch.replyDuration = dur(reply.time?.created, reply.time?.completed)
      }
      const updated = context.data.session.get(sessionID)?.time?.updated
      if (updated) patch.updated = updated
      remember(sessionID, patch)
    }

    const backfillState = new Map<string, { at: number; done: boolean }>()

    const runBackfill = async (sessionID: string) => {
      const list = messages(context, sessionID)
      const cachedUser = lastUser(list)
      const cachedThought = lastThought(list)
      const cachedReply = lastReply(list)
      rememberFromList(sessionID)

      let needReply = !cachedReply
      let needThought = !cachedThought
      if (cachedUser && !needReply && !needThought) return

      const response = await context.client.message.list({
        sessionID,
        type: "user",
        order: "desc",
        limit: 1,
      })
      const user = response.data[0] as any
      if (user?.time?.created) {
        remember(sessionID, {
          user: user.time.created,
          updated: context.data.session.get(sessionID)?.time?.updated,
        })
      }

      if (!needReply && !needThought) return
      // The cursor encodes a timeline position. Reusing the last-user cursor with
      // the assistant type walks backwards from the user instead of through the
      // current turn's tool loop, which is what makes long sessions cheap to scan.
      let cursor = response.cursor.next ?? undefined
      if (!cursor) return

      for (let page = 0; page < 10 && (needReply || needThought); page++) {
        const pageResult = await context.client.message
          .list({
            sessionID,
            type: "assistant",
            limit: 50,
            cursor,
          })
          .catch(() => undefined)
        if (!pageResult) break
        for (const message of pageResult.data as any[]) {
          if (needReply && message.time?.completed) {
            const part = (message.content ?? []).find(
              (item: any) => item.type === "text" && item.text?.trim(),
            )
            if (part) {
              remember(sessionID, {
                reply: message.time.completed,
                replyDuration: dur(message.time.created, message.time.completed),
                updated: context.data.session.get(sessionID)?.time?.updated,
              })
              needReply = false
            }
          }
          if (needThought) {
            const part = (message.content ?? []).find(
              (item: any) => item.type === "reasoning" && item.time?.created,
            )
            if (part) {
              remember(sessionID, {
                thought: part.time.created,
                thoughtDuration: dur(part.time.created, part.time.completed),
                updated: context.data.session.get(sessionID)?.time?.updated,
              })
              needThought = false
            }
          }
          if (!needReply && !needThought) break
        }
        cursor = pageResult.cursor.next ?? undefined
        if (!cursor) break
      }
    }

    const ensureAnchors = (sessionID: string) => {
      const now = Date.now()
      const state = backfillState.get(sessionID)
      const sessionUpdated = context.data.session.get(sessionID)?.time?.updated ?? 0
      const anchorUpdated = anchors[sessionID]?.updated ?? 0
      if (state?.done && sessionUpdated <= anchorUpdated) return
      if (state && now - state.at < 10_000) return
      backfillState.set(sessionID, { at: now, done: false })
      void runBackfill(sessionID)
        .then(() => {
          backfillState.set(sessionID, { at: Date.now(), done: true })
        })
        .catch(() => {})
    }

    let dirty = true
    let wasRunning = false
    let syncing = false
    let lastSync = 0
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

      ensureAnchors(sessionID)

      const now = Date.now()
      const running = context.data.session.status(sessionID) === "running"
      const transition = wasRunning && !running
      wasRunning = running
      const due =
        (dirty && now - lastSync >= 1_000) ||
        (running && now - lastSync >= 5_000) ||
        transition

      if (!due || syncing) {
        bump()
        return
      }

      dirty = false
      lastSync = now
      syncing = true
      Promise.allSettled([
        context.data.session.sync(sessionID),
        context.data.session.message.sync(sessionID),
      ]).finally(() => {
        syncing = false
        rememberFromList(sessionID)
        bump()
      })
    }

    const timer = setInterval(refresh, 1_000)
    refresh()

    // 1) Current-turn elapsed time in the prompt footer.
    const PromptClock = () => {
      onMount(() => {
        const route = context.ui.router.current()
        const sessionID = route.type === "session" ? (route.sessionID as string) : undefined
        if (sessionID) ensureAnchors(sessionID)
      })

      const elapsed = createMemo(() => {
        tick()
        const route = context.ui.router.current()
        const sessionID = route.type === "session" ? (route.sessionID as string) : undefined
        if (!sessionID) return "—"

        const turn = currentTurn(messages(context, sessionID), anchors[sessionID]?.user)
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
      onMount(() => ensureAnchors(props.sessionID))

      const values = createMemo((): TimingValues => {
        tick()
        const list = messages(context, props.sessionID)
        const session = context.data.session.get(props.sessionID)
        const anchor = anchors[props.sessionID] ?? {}
        const input = lastUser(list)
        const thought = lastThought(list)
        const reply = lastReply(list)
        const cachedInput = input?.time?.created ?? 0
        const cachedThought = thought?.time?.created ?? 0
        const cachedReply = reply?.time?.completed ?? 0
        const inputTime = Math.max(cachedInput, anchor.user ?? 0) || undefined
        const thoughtTime = Math.max(cachedThought, anchor.thought ?? 0) || undefined
        const replyTime = Math.max(cachedReply, anchor.reply ?? 0) || undefined
        const thoughtDuration =
          cachedThought >= (anchor.thought ?? 0)
            ? dur(thought?.time?.created, thought?.time?.completed)
            : anchor.thoughtDuration
        const replyDuration =
          cachedReply >= (anchor.reply ?? 0)
            ? dur(reply?.time?.created, reply?.time?.completed)
            : anchor.replyDuration
        const started = session?.time?.created

        return {
          started: { at: started, rank: 0, text: line(started, "started") },
          input: { at: inputTime, rank: 1, text: line(inputTime, "input") },
          thought: {
            at: thoughtTime,
            rank: 2,
            text: line(thoughtTime, "thought", thoughtDuration),
          },
          reply: { at: replyTime, rank: 3, text: line(replyTime, "reply", replyDuration) },
        }
      })

      const order = createMemo(() => {
        const current = values()
        const keys: TimingKey[] = ["started", "input", "thought", "reply"]
        return keys.sort((left, right) => {
          const a = current[left]
          const b = current[right]
          if (a.at === undefined && b.at === undefined) return a.rank - b.rank
          if (a.at === undefined) return 1
          if (b.at === undefined) return -1
          if (a.at !== b.at) return a.at - b.at
          return a.rank - b.rank
        })
      })

      return (
        <box flexDirection="column">
          <text fg={context.theme.text.base} attributes={TextAttributes.BOLD}>Session Timings</text>
          <For each={order()}>
            {(key) => <text fg={context.theme.text.muted} content={values()[key].text} />}
          </For>
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
