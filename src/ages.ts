// Minute-granularity relative ages.
//
// The label only changes at the boundary of the unit it displays, so callers
// can schedule a single timeout for the next visible change instead of
// repainting once per second.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export const ago = (ms: number, now: number) => {
  const seconds = Math.max(0, Math.floor((now - ms) / 1000))
  if (seconds < 60) return "just now"
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

// The first instant at which `ago(ms, now)` would render a different label.
export const nextAgeBoundary = (ms: number, now: number) => {
  const seconds = Math.max(0, Math.floor((now - ms) / 1000))
  if (seconds < 60) return ms + MINUTE
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return ms + (minutes + 1) * MINUTE
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return ms + (hours + 1) * HOUR
  const days = Math.floor(hours / 24)
  if (days < 7) return ms + (days + 1) * DAY
  if (days < 30) {
    // Weeks stop at the month threshold: 29d -> 30d is the next label change,
    // not 35d.
    const nextWeek = ms + (Math.floor(days / 7) + 1) * WEEK
    return Math.min(nextWeek, ms + 30 * DAY)
  }
  if (days < 365) {
    // Months stop at the year threshold: 364d -> 365d is the next change,
    // not 390d.
    const nextMonth = ms + (Math.floor(days / 30) + 1) * MONTH
    return Math.min(nextMonth, ms + 365 * DAY)
  }
  return ms + (Math.floor(days / 365) + 1) * YEAR
}

// The soonest boundary across every timestamp that is currently displayed.
export const nextBoundary = (timestamps: ReadonlyArray<number | undefined>, now: number) => {
  let next = Number.POSITIVE_INFINITY
  for (const ms of timestamps) {
    if (!ms) continue
    next = Math.min(next, nextAgeBoundary(ms, now))
  }
  return Number.isFinite(next) ? next : undefined
}
