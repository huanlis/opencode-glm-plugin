import type { QuotaLimit, Snapshot, UsageRange } from "./bigmodel"

/** Pure view helpers shared by the window shell and the panel. */

/** The panel's compact width, in CSS pixels. */
export const PANEL_WIDTH = 340

/** The tier of a used percentage, for colors and wording. */
export type Tier = "ok" | "warn" | "danger"

export function tierOf(percentage: number | undefined): Tier | undefined {
  if (percentage === undefined) return undefined
  if (percentage >= 95) return "danger"
  if (percentage >= 80) return "warn"
  return "ok"
}

/** CSS color for a tier, from the app's own status tokens. */
export function tierColor(tier: Tier | undefined): string | undefined {
  if (tier === "danger") return "var(--icon-critical-base, #e5484d)"
  if (tier === "warn") return "var(--icon-warning-base, #f5a524)"
  if (tier === "ok") return "var(--icon-success-base, #46a758)"
  return undefined
}

/**
 * The headline percentage: the first limit that reports one, preferring the
 * 5-hour token window, then credit windows, then anything else.
 */
export function primaryPercentage(snapshot: Snapshot | undefined): number | undefined {
  if (!snapshot || snapshot.status !== "ok") return undefined
  const order: QuotaLimit["kind"][] = ["tokens-5h", "credit-5h", "credit-week", "credit-month", "time-month", "other"]
  for (const kind of order) {
    const limit = snapshot.limits.find((entry) => entry.kind === kind)
    if (limit?.percentage !== undefined) return limit.percentage
  }
  return snapshot.limits.find((limit) => limit.percentage !== undefined)?.percentage
}

/** Whether any limit has run out. */
export function isLimited(snapshot: Snapshot | undefined): boolean {
  if (!snapshot) return false
  return snapshot.limits.some((limit) => (limit.percentage ?? 0) >= 100)
}

/** Humanizes token counts per locale: 万/亿 for zh, K/M/B otherwise. */
export function formatTokens(value: number, zh: boolean): string {
  if (!Number.isFinite(value)) return "0"
  if (zh) {
    if (value >= 1e8) return `${strip(value / 1e8)} 亿`
    if (value >= 1e4) return `${strip(value / 1e4)} 万`
    return String(Math.round(value))
  }
  if (value >= 1e9) return `${strip(value / 1e9)}B`
  if (value >= 1e6) return `${strip(value / 1e6)}M`
  if (value >= 1e3) return `${strip(value / 1e3)}K`
  return String(Math.round(value))
}

function strip(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "")
}

/** Humanizes a duration for the reset countdown, in whole units. */
export function formatCountdown(ms: number, zh: boolean): string {
  if (ms <= 0) return zh ? "即将重置" : "any moment"
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return zh ? `${Math.max(1, minutes)} 分钟` : `${Math.max(1, minutes)} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return zh ? `${hours} 小时` : `${hours} h`
  const days = Math.round(hours / 24)
  return zh ? `${days} 天` : `${days} d`
}

/** The chart buckets of a range, already downsampled by main. */
export function bucketsOf(range: UsageRange | undefined): UsageRange["buckets"] {
  return range?.buckets ?? []
}
