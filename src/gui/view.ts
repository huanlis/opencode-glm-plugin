import type { PlanQuota, QuotaLimit, Snapshot, UsageRange } from "./bigmodel"

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

/** Translation function narrowed to the plan-name keys; `ctx.t` fits it. */
type PlanTitleT = (key: "plan.personal" | "plan.team" | "plan.unnamed") => string

/** The card title of a plan: the user's `label` wins, else a name from its type. */
export function planTitle(t: PlanTitleT, plan: PlanQuota): string {
  return plan.label ?? t(plan.planType === 1 ? "plan.personal" : plan.planType === 2 ? "plan.team" : "plan.unnamed")
}

/** Translation function narrowed to the short plan-name keys. */
type PlanTagT = (key: "plan.tagPersonal" | "plan.tagTeam" | "plan.tagOther") => string

/** The short name for the pill and menu, resolved like `planTitle`. */
export function planTag(t: PlanTagT, plan: PlanQuota): string {
  return plan.label ?? t(plan.planType === 1 ? "plan.tagPersonal" : plan.planType === 2 ? "plan.tagTeam" : "plan.tagOther")
}

/** Translation function narrowed to the tab-name keys. */
type PlanTabT = (key: "tab.personal" | "tab.team" | "plan.tagOther") => string

/**
 * The tab label of a plan: the user's `label`, else a name short enough for
 * the header row (English drops the "plan" word the card title keeps).
 */
export function planTabName(t: PlanTabT, plan: PlanQuota): string {
  if (plan.label) return plan.label
  return t(plan.planType === 1 ? "tab.personal" : plan.planType === 2 ? "tab.team" : "plan.tagOther")
}

/** One ok plan plus its headline percentage. */
export interface PlanHeadline {
  readonly plan: PlanQuota
  readonly percentage: number
}

/** Headlines for the pill and the + menu: one entry per ok plan, in snapshot order. */
export function planHeadlines(snapshot: Snapshot | undefined): PlanHeadline[] {
  const headlines: PlanHeadline[] = []
  for (const plan of snapshot?.plans ?? []) {
    const percentage = primaryPercentageOf(plan)
    if (percentage !== undefined) headlines.push({ plan, percentage })
  }
  return headlines
}

/**
 * A plan's headline percentage: the first limit that reports one, preferring
 * the 5-hour window, then credit windows, then anything else.
 */
export function primaryPercentageOf(plan: PlanQuota | undefined): number | undefined {
  if (!plan || plan.status !== "ok") return undefined
  const order: QuotaLimit["kind"][] = ["tokens-5h", "credit-5h", "credit-week", "credit-month", "time-month", "other"]
  for (const kind of order) {
    const limit = plan.limits.find((entry) => entry.kind === kind)
    if (limit?.percentage !== undefined) return limit.percentage
  }
  return plan.limits.find((limit) => limit.percentage !== undefined)?.percentage
}

/** Whether a plan has run out of any window. */
export function isLimitedOf(plan: PlanQuota): boolean {
  return plan.limits.some((limit) => (limit.percentage ?? 0) >= 100)
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
