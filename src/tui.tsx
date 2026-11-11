/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { ago, nextBoundary } from "./ages"

// opencode-session-time: timestamps for your OpenCode sessions.
//
//  - prompt.footer.status — elapsed time for the current turn near the prompt;
//  - sidebar.content      — a "Session Timings" block (started / input / thought / reply);
//  - /time                  — palette-style timeline popup (dialog.select).
//
// Note: the OpenCode plugin API has no slot for the per-message footer, so
// inline timestamps under each message are not possible yet (upstream feature
// request: a `message.footer` slot).

const pad = (n: number) => String(n).padStart(2, "0")

// setTimeout clamps delays to a signed 32-bit integer (~24.8 days).
const MAX_TIMEOUT = 2_147_483_647

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

const durMs = (ms: number) => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  if (minutes < 60) return `${minutes}m${pad(seconds)}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${pad(minutes % 60)}m`
  return `${Math.floor(hours / 24)}d${pad(hours % 24)}h`
}

const line = (ms: number | undefined, label: string, duration?: string, now?: number) => {
  if (!ms) return `— ${label}`
  return `${fmt(ms)} ${label}${duration ? ` · ${duration}` : ""}${now === undefined ? "" : ` · ${ago(ms, now)}`}`
}

const preview = (message: any): string => {
  const content = message.content
  let text = ""
  if (typeof content === "string") text = content
  else if (Array.isArray(content))
    text = content
      .map((part: any) => (typeof part === "string" ? part : part?.type === "text" ? (part.text ?? "") : ""))
      .join(" ")
  text = text.replace(/\s+/g, " ").trim()
  return text.length > 110 ? `${text.slice(0, 110)}…` : text
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

  // A new user message without an assistant response yet means the next turn
  // has not started. Do not keep showing the previous turn's elapsed time.
  if (lastUser > lastAssistant) return { waiting: true }

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

const BUILTIN_TOOLS = new Set([
  "shell", "read", "write", "edit", "glob", "grep", "webfetch", "websearch",
  "task", "subagent", "skill", "todo", "todowrite", "todoread", "question",
  "execute", "ls", "patch", "apply_patch", "codesearch",
])

type SessionCounts = {
  user: number
  steps: number
  mcp: number
  tools: Record<string, number>
  capped: boolean
  at: number
}

const tallyToolParts = (message: any, counts: SessionCounts) => {
  for (const part of message.content ?? []) {
    if (part.type !== "tool") continue
    const name = part.name ?? "?"
    counts.tools[name] = (counts.tools[name] ?? 0) + 1
    if (!BUILTIN_TOOLS.has(name)) counts.mcp++
  }
}

const turnTools = (list: any[]) => {
  let userIdx = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === "user") { userIdx = i; break }
  }
  let total = 0
  let mcp = 0
  const counts: Record<string, number> = {}
  for (let i = list.length - 1; i > userIdx; i--) {
    const message = list[i]
    if (message.type !== "assistant" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type !== "tool") continue
      total++
      const name = part.name ?? "?"
      counts[name] = (counts[name] ?? 0) + 1
      if (!BUILTIN_TOOLS.has(name)) mcp++
    }
  }
  return { total, mcp, counts }
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

const thoughtStats = (list: any[]) => {
  // reasoning phases since the last user input (all assistant steps of the turn)
  let userIdx = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === "user") { userIdx = i; break }
  }
  let count = 0
  let totalMs = 0
  let last: any
  for (let i = list.length - 1; i > userIdx; i--) {
    const message = list[i]
    if (message.type !== "assistant" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type !== "reasoning" || !part.time?.created) continue
      count++
      if (!last) last = part
      const end = part.time.completed
      if (end && end >= part.time.created) totalMs += end - part.time.created
    }
  }
  return { last, count, totalMs }
}

const lastReply = (list: any[]) => {
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i]
    if (message.type !== "assistant" || !message.time?.completed) continue
    if (message.content?.some((part: any) => part.type === "text" && part.text?.trim())) return message
  }
}

type TimingKey = "started" | "input" | "thought" | "reply"

type TimingValue = {
  at?: number
  text: string
  rank: number
}

type TimingValues = Record<TimingKey, TimingValue>

type Anchor = {
  user?: number
  thought?: number
  thoughtDuration?: string
  thoughtCount?: number
  counts?: SessionCounts
  reply?: number
  replyDuration?: string
  updated?: number
}

type AnchorStore = Record<string, Anchor>

const mergeAnchor = (current: Anchor, patch: Anchor): Anchor | undefined => {
  const next: Anchor = { ...current }
  let changed = false

  if (patch.user !== undefined && patch.user > (current.user ?? 0)) {
    next.user = patch.user
    changed = true
  }
  if (patch.thought !== undefined && patch.thought >= (current.thought ?? 0)) {
    if (patch.thought !== current.thought || patch.thoughtDuration !== current.thoughtDuration || patch.thoughtCount !== current.thoughtCount) {
      next.thought = patch.thought
      next.thoughtDuration = patch.thoughtDuration
      next.thoughtCount = patch.thoughtCount
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
  if (patch.counts && (!current.counts || patch.counts.at >= current.counts.at)) {
    next.counts = patch.counts
    changed = true
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
    const relativeAges = context.options.relativeAges === true
    const defaultLayout = context.options.sidebarLayout === "blocks" ? "blocks" : "classic"

    // One tick drives the footer stopwatch. Sidebar ages use a boundary timer
    // when enabled, so an idle session does not repaint every second.
    const [tick, setTick] = createSignal(0)
    const [agesNow, setAgesNow] = createSignal(Date.now())
    const bump = () => setTick((t) => t + 1)

    const [layout, updateLayout] = context.storage.store("layout", {
      initial: { mode: defaultLayout },
    })
    const layoutMode = () => (layout.mode === "blocks" ? "blocks" : "classic")
    const toggleLayout = () => {
      void updateLayout((draft) => {
        draft.mode = layoutMode() === "classic" ? "blocks" : "classic"
      }).catch(() => {})
    }

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

    const windowCounts = (list: any[]): SessionCounts => {
      const counts: SessionCounts = { user: 0, steps: 0, mcp: 0, tools: {}, capped: true, at: Date.now() }
      for (const m of list) {
        if (m.type === "user") counts.user++
        if (m.type === "assistant") { counts.steps++; tallyToolParts(m, counts) }
      }
      return counts
    }

    const fullCounts = async (sessionID: string): Promise<SessionCounts> => {
      const counts: SessionCounts = { user: 0, steps: 0, mcp: 0, tools: {}, capped: false, at: Date.now() }
      let cursor: string | undefined
      for (let page = 0; page < 40; page++) {
        const res: any = await context.client.message
          .list({ sessionID, limit: 100, cursor })
          .catch(() => undefined)
        if (!res) break
        for (const m of res.data as any[]) {
          if (m.type === "user") counts.user++
          if (m.type === "assistant") { counts.steps++; tallyToolParts(m, counts) }
        }
        cursor = res.cursor?.next ?? undefined
        if (!cursor) break
      }
      return counts
    }

    const rememberFromList = (sessionID: string) => {
      const list = messages(context, sessionID)
      const user = lastUser(list)
      const thought = thoughtStats(list)
      const reply = lastReply(list)
      const patch: Anchor = {}
      if (user?.time?.created) patch.user = user.time.created
      if (thought.last?.time?.created) {
        patch.thought = thought.last.time.created
        patch.thoughtDuration = durMs(thought.totalMs)
        patch.thoughtCount = thought.count
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
      const cachedThought = thoughtStats(list).last
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
            const phases = (message.content ?? []).filter(
              (item: any) => item.type === "reasoning" && item.time?.created,
            )
            if (phases.length > 0) {
              const last = phases[phases.length - 1]
              const totalMs = phases.reduce(
                (sum: number, p: any) =>
                  sum + (p.time?.completed && p.time.completed >= p.time.created ? p.time.completed - p.time.created : 0),
                0,
              )
              remember(sessionID, {
                thought: last.time.created,
                thoughtDuration: durMs(totalMs),
                thoughtCount: phases.length,
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
      const existingCounts = anchors[sessionID]?.counts
      if (!existingCounts || existingCounts.capped || now - (existingCounts.at ?? 0) > 60_000) {
        void fullCounts(sessionID).then((c) => remember(sessionID, { counts: c })).catch(() => {})
      }
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

      return <text fg={context.theme.text.muted} content={`⏱ ${elapsed()}`}
        onMouseUp={(e: any) => { e?.stopPropagation?.(); void openTimeline() }} />
    }

    // 2) v0.4.0 "Session" / "Last answer" block in the sidebar.
    const SessionSidebar = (props: { sessionID: string }) => {
      onMount(() => ensureAnchors(props.sessionID))
      const theme = context.theme
      const [view, updateView] = context.storage.store("view", { initial: { open: true } })
      const toggle = () => {
        void updateView((draft) => {
          draft.open = !draft.open
        }).catch(() => {})
      }

      const model = createMemo(() => {
        if (relativeAges) agesNow()
        // Recompute "now" on every memo run (data change, boundary wake,
        // route/theme change) so newly arrived rows are not stale between ticks.
        const now = relativeAges ? Date.now() : undefined
        const list = messages(context, props.sessionID)
        const session = context.data.session.get(props.sessionID)
        const anchor = anchors[props.sessionID] ?? {}
        const input = lastUser(list)
        const thought = thoughtStats(list)
        const reply = lastReply(list)
        const tools = turnTools(list)
        const counts = anchor.counts ?? windowCounts(list)

        const cachedThought = thought.last?.time?.created ?? 0
        const cachedReply = reply?.time?.completed ?? 0
        const inputTime = Math.max(input?.time?.created ?? 0, anchor.user ?? 0) || undefined
        const thoughtTime = Math.max(cachedThought, anchor.thought ?? 0) || undefined
        const replyTime = Math.max(cachedReply, anchor.reply ?? 0) || undefined
        const thoughtDuration =
          cachedThought >= (anchor.thought ?? 0) ? durMs(thought.totalMs) : anchor.thoughtDuration
        const thoughtCount =
          cachedThought >= (anchor.thought ?? 0) ? thought.count : (anchor.thoughtCount ?? 1)
        const replyDuration =
          cachedReply >= (anchor.reply ?? 0)
            ? dur(reply?.time?.created, reply?.time?.completed)
            : anchor.replyDuration

        const toolTop = Object.entries(tools.counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([n, c]) => `${n} ${c}`)
          .join(" · ")

        const started = session?.time?.created
        const age = (ms: number | undefined) => (now === undefined || !ms ? "" : ` · ${ago(ms, now)}`)

        return {
          summary: `${counts.user} req · ${counts.steps} steps${counts.capped ? "+" : ""}`,
          startedTime: fmt(started),
          startedAt: started,
          startedAge: age(started),
          requests: String(counts.user),
          steps: `${counts.steps}${counts.capped ? "+" : ""}`,
          inputTime: fmt(inputTime),
          inputAt: inputTime,
          inputAge: age(inputTime),
          thoughtLabel: `Thought${thoughtCount > 1 ? ` ×${thoughtCount}` : ""}`,
          thoughtInfo: thoughtDuration ? ` · ${thoughtDuration}` : "",
          thoughtTime: fmt(thoughtTime),
          thoughtAt: thoughtTime,
          thoughtAge: age(thoughtTime),
          replyInfo: replyDuration ? ` · ${replyDuration}` : "",
          replyTime: fmt(replyTime),
          replyAt: replyTime,
          replyAge: age(replyTime),
          showTools: tools.total > 0,
          toolsTotal: String(tools.total),
          toolsInfo: toolTop ? ` · ${toolTop}` : "",
        }
      })

      createEffect(() => {
        if (!relativeAges || !view.open) return
        const current = model()
        const now = Date.now()
        const next = nextBoundary(
          [current.startedAt, current.inputAt, current.thoughtAt, current.replyAt],
          now,
        )
        if (next === undefined) return
        // Clamp distant boundaries to the setTimeout limit and re-arm when the
        // clamp expires. The label is unchanged until the real boundary.
        const delay = Math.min(MAX_TIMEOUT, Math.max(250, next - now))
        const timer = setTimeout(() => setAgesNow(Date.now()), delay)
        onCleanup(() => clearTimeout(timer))
      })

      return (
        <box flexDirection="column">
          <box flexDirection="row" onMouseUp={toggle}>
            <text content={view.open ? "▼ " : "▶ "} />
            <text>
              <b>Session</b>
              <Show when={!view.open}>
                <span style={{ fg: theme.text.muted }}> ({model().summary})</span>
              </Show>
            </text>
            <box flexGrow={1} />
            <text
              style={{ fg: theme.text.muted }}
              onMouseUp={(e: any) => {
                e?.stopPropagation?.()
                toggleLayout()
              }}
            >
              ⇄
            </text>
          </box>

          <Show when={view.open}>
            <box flexDirection="row" gap={1} minWidth={0}>
              <text flexShrink={0} style={{ fg: theme.text.muted }}>•</text>
              <text wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}><span style={{ fg: theme.text.muted }}>Started{model().startedAge}</span></text>
              <text fg={theme.text.base} wrapMode="none" flexShrink={0}>{model().startedTime}</text>
            </box>
            <box flexDirection="row" gap={1} minWidth={0}>
              <text flexShrink={0} style={{ fg: theme.text.muted }}>•</text>
              <text wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                <span style={{ fg: theme.text.muted }}>Requests</span>
                <span style={{ fg: theme.text.base }}> {model().requests}</span>
                <span style={{ fg: theme.text.muted }}> · </span>
                <span style={{ fg: theme.text.muted }}>Steps</span>
                <span style={{ fg: theme.text.base }}> {model().steps}</span>
              </text>
            </box>

            <box flexDirection="column" paddingLeft={2}>
              <box flexDirection="row" onMouseUp={() => void openTimeline()}>
                <text>
                  <b>Last answer</b>
                  <span style={{ fg: theme.text.muted }}>  ⏱</span>
                </text>
              </box>
              <box flexDirection="row" gap={1} minWidth={0}>
                <text flexShrink={0} style={{ fg: theme.text.muted }}>•</text>
                <text wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}><span style={{ fg: theme.text.muted }}>User{model().inputAge}</span></text>
                <text fg={theme.text.base} wrapMode="none" flexShrink={0}>{model().inputTime}</text>
              </box>
              <box flexDirection="row" gap={1} minWidth={0}>
                <text flexShrink={0} style={{ fg: theme.text.muted }}>•</text>
                <text wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                  <span style={{ fg: theme.text.muted }}>{model().thoughtLabel}</span>
                  <span style={{ fg: theme.text.muted }}>{model().thoughtInfo}</span>
                  <span style={{ fg: theme.text.muted }}>{model().thoughtAge}</span>
                </text>
                <text fg={theme.text.base} wrapMode="none" flexShrink={0}>{model().thoughtTime}</text>
              </box>
              <box flexDirection="row" gap={1} minWidth={0}>
                <text flexShrink={0} style={{ fg: theme.text.muted }}>•</text>
                <text wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                  <span style={{ fg: theme.text.muted }}>Reply</span>
                  <span style={{ fg: theme.text.muted }}>{model().replyInfo}</span>
                  <span style={{ fg: theme.text.muted }}>{model().replyAge}</span>
                </text>
                <text fg={theme.text.base} wrapMode="none" flexShrink={0}>{model().replyTime}</text>
              </box>
              <Show when={model().showTools}>
                <box flexDirection="row" gap={1} minWidth={0}>
                  <text flexShrink={0} style={{ fg: theme.text.muted }}>•</text>
                  <text wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                    <span style={{ fg: theme.text.muted }}>Tools {model().toolsTotal}</span>
                    <span style={{ fg: theme.text.muted }}>{model().toolsInfo}</span>
                  </text>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      )
    }

    // 3) Classic v0.3.2 four-row block.
    const ClassicSidebar = (props: { sessionID: string }) => {
      const theme = context.theme
      onMount(() => ensureAnchors(props.sessionID))

      const values = createMemo((): TimingValues => {
        if (relativeAges) agesNow()
        const now = relativeAges ? Date.now() : undefined
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
          started: { at: started, rank: 0, text: line(started, "started", undefined, now) },
          input: { at: inputTime, rank: 1, text: line(inputTime, "input", undefined, now) },
          thought: {
            at: thoughtTime,
            rank: 2,
            text: line(thoughtTime, "thought", thoughtDuration, now),
          },
          reply: { at: replyTime, rank: 3, text: line(replyTime, "reply", replyDuration, now) },
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

      createEffect(() => {
        if (!relativeAges) return
        const current = values()
        const now = Date.now()
        const next = nextBoundary(
          [current.started.at, current.input.at, current.thought.at, current.reply.at],
          now,
        )
        if (next === undefined) return
        const delay = Math.min(MAX_TIMEOUT, Math.max(250, next - now))
        const timer = setTimeout(() => setAgesNow(Date.now()), delay)
        onCleanup(() => clearTimeout(timer))
      })

      return (
        <box flexDirection="column">
          <box flexDirection="row">
            <text><b>Session Timings</b></text>
            <box flexGrow={1} />
            <text
              style={{ fg: theme.text.muted }}
              onMouseUp={(e: any) => {
                e?.stopPropagation?.()
                toggleLayout()
              }}
            >
              ⇄
            </text>
          </box>
          <For each={order()}>
            {(key) => <text fg={theme.text.muted} content={values()[key].text} />}
          </For>
        </box>
      )
    }

    const disposeClock = context.ui.slot({
      append: "prompt.footer.status",
      render: () => <PromptClock />,
    })

    const disposeSide = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => (
        <Show when={layoutMode() === "classic"} fallback={<SessionSidebar sessionID={sessionID} />}>
          <ClassicSidebar sessionID={sessionID} />
        </Show>
      ),
    })

    // Opens the /time timeline popup — shared by the /time command and the footer click.
    const openTimeline = async () => {
              // palette-style popup: searchable, navigable, Esc closes
              const route = context.ui.router.current()
              const sessionID = route.type === "session" ? (route.sessionID as string) : undefined
              if (sessionID) await context.data.session.message.sync(sessionID)
              const rows = (sessionID ? messages(context, sessionID) : []).filter(
                (message: any) => message.type === "assistant",
              )
              if (rows.length === 0) {
                context.ui.toast.show({ message: "No assistant turns yet" })
                return
              }
              // Esc in details returns to the timeline; Esc on the list exits
              for (;;) {
                const selection = context.ui.dialog.select({
                  title: `Session timeline · ${rows.length} turns`,
                  // newest turns first
                  options: rows.slice().reverse().map((message: any) => {
                    const duration = dur(message.time?.created, message.time?.completed)
                    return {
                      title: `${fmt(message.time?.created)} · ${message.agent ?? "—"} · ${
                        message.model?.id ?? message.model ?? "—"
                      }${duration ? ` · ${duration}` : ""}`,
                      value: message.id,
                      description: preview(message) || "no text reply",
                    }
                  }),
                  search: (query, options) =>
                    options.filter((option) =>
                      `${option.title} ${option.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
                    ),
                  actions: [
                    {
                      bind: "ctrl+a",
                      title: "Close",
                      side: "right",
                      selection: "none",
                      onTrigger: () => context.ui.dialog.clear(),
                    },
                  ],
                })
                context.ui.dialog.set({ size: "xlarge", centered: true })
                const picked = await selection
                if (!picked) return
                const message: any = rows.find((m: any) => m.id === picked)
                if (!message) return
                const duration = dur(message.time?.created, message.time?.completed)
                const tok = message.tokens ?? {}
                const cache = tok.cache ?? {}
                const cost = typeof message.cost === "number" ? message.cost : 0
                const finish = message.finish ?? message.rawFinish ?? "—"
                // promise-based dialog: Escape is documented to resolve it
                const details = context.ui.dialog.alert({
                  title: "Turn details",
                  message: [
                    `started:   ${fmt(message.time?.created)}`,
                    `completed: ${message.time?.completed ? fmt(message.time.completed) : "in progress"}`,
                    `duration:  ${duration ?? "—"}`,
                    `agent:     ${message.agent ?? "—"}`,
                    `model:     ${message.model?.id ?? message.model ?? "—"}${message.model?.variant ? ` (${message.model.variant})` : ""}`,
                    `tokens:    in ${tok.input ?? 0} · out ${tok.output ?? 0} · reasoning ${tok.reasoning ?? 0} · cache read ${cache.read ?? 0}`,
                    `cost:      ${cost ? `$${cost.toFixed(4)}` : "$0"}`,
                    `finish:    ${String(finish)}`,
                    ``,
                    preview(message) || "no text reply",
                  ].join("\n"),
                })
                context.ui.dialog.set({ size: "xlarge", centered: true })
                await details
              }
    }

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
            run: () => { void openTimeline() },
          },
          {
            id: "session-time.layout",
            title: "Time: toggle sidebar layout",
            slash: { name: "time-layout" },
            run: () => toggleLayout(),
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
      disposeKeys?.()
    }
  },
})
