import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * BigModel (GLM Coding Plan) usage endpoints and response shapes.
 * Runs only in the desktop app's main process: plain Node fetch, no CORS.
 */

/** One entry of `options.plans`; unset fields inherit the entry's top-level value. */
export interface PlanOptions {
  readonly label?: string
  /** Plan type query for reformed credit plans: 1 personal, 2 team. */
  readonly planType?: number
  readonly organization?: string
  readonly project?: string
}

/** Options a user may set on the plugin entry in `opencode.json`. */
export interface GlmOptions {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly organization?: string
  readonly project?: string
  readonly planType?: number
  /** Explicit plan list; when set, only these plans are queried (no auto discovery). */
  readonly plans?: readonly PlanOptions[]
}

export interface GlmConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly organization?: string
  readonly project?: string
  readonly planType?: number
}

/** One quota line: a window the plan meters, e.g. the 5-hour token window. */
export interface QuotaLimit {
  readonly id: string
  readonly kind: "tokens-5h" | "credit-5h" | "credit-week" | "credit-month" | "time-month" | "other"
  /** Used percentage, 0-100, when the server reports or implies one. */
  readonly percentage?: number
  readonly usage?: number
  readonly currentValue?: number
  readonly remaining?: number
  /** Epoch ms when the window resets. */
  readonly nextResetTime?: number
}

export interface UsageBucket {
  readonly time: string
  readonly tokens: number
}

export interface UsageRange {
  readonly totalTokens: number
  readonly granularity: string
  readonly buckets: readonly UsageBucket[]
  readonly models: readonly { readonly name: string; readonly tokens: number }[]
  /** Cache hit rate, 0-1, when the server reports one. */
  readonly cacheHitRate?: number
  /** Raw input / cached totals, kept so summed ranges can re-derive the rate. */
  readonly inputTokens?: number
  readonly cachedInputTokens?: number
}

export type SnapshotStatus = "ok" | "no-key" | "error" | "empty"

/** One plan's quota and usage inside a snapshot. */
export interface PlanQuota {
  readonly label?: string
  /** The effective plan type after inheritance, `undefined` for a no-type query. */
  readonly planType?: number
  readonly status: "ok" | "empty" | "error"
  readonly message?: string
  /** Extra guidance the panel renders for an `empty` plan (new credit plans). */
  readonly hint?: "org-project"
  readonly level?: string
  readonly limits: readonly QuotaLimit[]
  /** This plan's own usage, when the server could report it. */
  readonly usageToday?: UsageRange
  readonly usage7d?: UsageRange
  readonly usage30d?: UsageRange
}

export interface Snapshot {
  readonly status: SnapshotStatus
  readonly message?: string
  /** Extra guidance the panel renders for `empty` (new credit plans) states. */
  readonly hint?: "org-project"
  readonly plans: readonly PlanQuota[]
  /** Every ok plan's limits, flattened for the single-plan consumers. */
  readonly limits: readonly QuotaLimit[]
  /** Every plan's usage added up: the account total the overview shows. */
  readonly usageToday?: UsageRange
  readonly usage7d?: UsageRange
  readonly usage30d?: UsageRange
  readonly fetchedAt: number
}

const ZHIPU_BASE = "https://open.bigmodel.cn"
const ZAI_BASE = "https://api.z.ai"
/** Provider ids in auth.json whose key talks to the GLM coding plan. */
const PROVIDER_IDS = ["zhipuai-coding-plan", "zai-coding-plan", "zai-coding-cn"]
const PROVIDER_PATTERN = /z(ai|hipu)/i

/** Reads the plugin entry's options loosely, so a malformed entry never throws. */
export function readOptions(raw: unknown): GlmOptions {
  if (!raw || typeof raw !== "object") return {}
  const o = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
  const plans = Array.isArray(o.plans)
    ? o.plans
        .map((entry): PlanOptions | undefined => {
          if (!entry || typeof entry !== "object") return undefined
          const p = entry as Record<string, unknown>
          return { label: str(p.label), planType: num(p.planType), organization: str(p.organization), project: str(p.project) }
        })
        .filter((plan): plan is PlanOptions => plan !== undefined)
    : undefined
  return {
    apiKey: str(o.apiKey),
    baseUrl: str(o.baseUrl),
    organization: str(o.organization),
    project: str(o.project),
    planType: num(o.planType),
    plans: plans && plans.length > 0 ? plans : undefined,
  }
}

/** Key resolution: plugin options, then environment, then opencode's auth.json. */
export function resolveConfig(options: GlmOptions): GlmConfig | { error: "no-key" } {
  const fromAuth = readAuthKey()
  const apiKey = options.apiKey ?? readEnvKey() ?? fromAuth?.key
  if (!apiKey) return { error: "no-key" }

  let baseUrl = options.baseUrl
  if (!baseUrl) {
    const provider = authProviderId(options)
    baseUrl = provider && provider.startsWith("zai") && !provider.includes("hipu") ? ZAI_BASE : ZHIPU_BASE
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    organization: options.organization,
    project: options.project,
    planType: options.planType,
  }
}

function authProviderId(options: GlmOptions): string | undefined {
  if (options.apiKey || readEnvKey()) return undefined
  return readAuthKey()?.provider
}

function readEnvKey(): string | undefined {
  for (const name of ["GLM_API_KEY", "ZHIPU_CODING_PLAN_API_KEY", "ZHIPUAI_CODING_PLAN_API_KEY", "ZAI_CODING_CN_API_KEY"]) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  return undefined
}

function authPaths(): string[] {
  const home = os.homedir()
  return [
    path.join(home, ".local", "share", "opencode", "auth.json"),
    // macOS app-sandboxed default, just in case.
    path.join(home, "Library", "Application Support", "opencode", "auth.json"),
  ]
}

function readAuthKey(): { key: string; provider: string } | undefined {
  for (const file of authPaths()) {
    let auth: unknown
    try {
      auth = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      continue
    }
    if (!auth || typeof auth !== "object") continue
    const entries = auth as Record<string, unknown>
    const ids = [...PROVIDER_IDS, ...Object.keys(entries)]
    for (const id of ids) {
      const entry = entries[id]
      const key =
        entry && typeof entry === "object" && "key" in entry && typeof (entry as { key?: unknown }).key === "string"
          ? (entry as { key: string }).key.trim()
          : undefined
      if (key && (PROVIDER_IDS.includes(id) || PROVIDER_PATTERN.test(id))) return { key, provider: id }
    }
  }
  return undefined
}

/** A plan to query: `explicit` ones stay in the snapshot even when empty or failed. */
interface PlanQuery {
  readonly label?: string
  readonly planType?: number
  readonly organization?: string
  readonly project?: string
  readonly explicit: boolean
}

/**
 * Plans to fetch. An explicit `plans` list wins; otherwise auto-discovery asks
 * for the configured type first, then both standard types, and — only when no
 * type is configured — one parameter-less request as a fallback for servers
 * that reject the parameter.
 */
function planQueries(options: GlmOptions): PlanQuery[] {
  if (options.plans) return options.plans.map((plan) => ({ ...plan, explicit: true }))
  const types: (number | undefined)[] = [1, 2]
  if (options.planType !== undefined && options.planType !== 1 && options.planType !== 2) types.unshift(options.planType)
  // A parameter-less request only as a fallback, behind the typed ones, so a
  // typed result wins the dedup and the plan keeps its personal/team name.
  if (options.planType === undefined) types.push(undefined)
  const seen = new Set<string>()
  const queries: PlanQuery[] = []
  for (const planType of types) {
    const key = planType === undefined ? "none" : String(planType)
    if (seen.has(key)) continue
    seen.add(key)
    queries.push({ planType, explicit: planType !== undefined && planType === options.planType })
  }
  return queries
}

class EmptyQuotaError extends Error {
  constructor() {
    super("no quota limits in response")
  }
}

const pad = (n: number) => String(n).padStart(2, "0")

/** The endpoints take local time as `yyyy-MM-dd HH:mm:ss`. */
function formatLocal(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

async function getJson(config: GlmConfig, url: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: config.apiKey,
    "Content-Type": "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  }
  if (config.organization) headers["bigmodel-organization"] = config.organization
  if (config.project) headers["bigmodel-project"] = config.project

  const response = await fetch(url, { headers })
  const body = (await response.json().catch(() => undefined)) as
    | { code?: number; msg?: string; success?: boolean; data?: unknown }
    | undefined

  if (!response.ok) throw new Error(body?.msg ?? `HTTP ${response.status}`)
  if (!body || body.success === false || (typeof body.code === "number" && body.code !== 200))
    throw new Error(body?.msg ?? "unexpected response")
  return body.data
}

/** `/api/monitor/usage/quota/limit`: every window the plan meters. */
async function fetchQuota(config: GlmConfig): Promise<{ level?: string; limits: QuotaLimit[]; fingerprint: string }> {
  const query = config.planType === undefined ? "" : `?type=${config.planType}`
  const data = (await getJson(config, `${config.baseUrl}/api/monitor/usage/quota/limit${query}`)) as
    | { level?: string; limits?: unknown }
    | undefined

  const raw = Array.isArray(data?.limits) ? (data!.limits as Record<string, unknown>[]) : []
  if (raw.length === 0) throw new EmptyQuotaError()

  const limits = raw.map((entry, index) => toLimit(entry, index))
  const level = typeof data?.level === "string" ? data.level : undefined
  // The plan's identity: reset times drift a few milliseconds between calls,
  // so dedup judges on the structure (tier + window kinds) instead.
  const fingerprint = `${level ?? "-"}|${raw
    .map((entry) => `${String(entry.type)}|${String(entry.unit)}|${String(entry.number)}`)
    .sort()
    .join(",")}`
  return { level, limits, fingerprint }
}

function toLimit(entry: Record<string, unknown>, index: number): QuotaLimit {
  const type = typeof entry.type === "string" ? entry.type : ""
  const unit = typeof entry.unit === "number" ? entry.unit : undefined
  const usage = num(entry.usage)
  const current = num(entry.currentValue)
  const remaining = num(entry.remaining)
  const reported = num(entry.percentage)
  const percentage = reported ?? (usage && usage > 0 && current !== undefined ? (current / usage) * 100 : undefined)

  let kind: QuotaLimit["kind"] = "other"
  if (type === "TOKENS_LIMIT") kind = "tokens-5h"
  else if (type === "CREDIT_LIMIT") kind = unit === 6 ? "credit-week" : unit === 5 ? "credit-month" : "credit-5h"
  else if (type === "TIME_LIMIT") kind = "time-month"

  return {
    id: `${type || "limit"}-${unit ?? "x"}-${index}`,
    kind,
    percentage,
    usage,
    currentValue: current,
    remaining,
    nextResetTime: num(entry.nextResetTime),
  }
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * The usage endpoint's plan selector: 1 personal, 3 team. 2 is the enterprise
 * aggregate and only answers for the main account, so it is never used.
 */
function usageTypeOf(planType: number | undefined): number {
  return planType === 2 ? 3 : 1
}

/** `/api/monitor/token-usage/usage-detail`: one plan's tokens, per model, day or hour buckets. */
async function fetchUsageBetween(config: GlmConfig, start: Date, end: Date): Promise<UsageRange> {
  const query =
    `startTime=${encodeURIComponent(formatLocal(start))}` +
    `&endTime=${encodeURIComponent(formatLocal(end))}` +
    `&type=${usageTypeOf(config.planType)}&usageType=MODEL`
  const data = (await getJson(config, `${config.baseUrl}/api/monitor/token-usage/usage-detail?${query}`)) as
    | {
        granularity?: unknown
        summary?: { totalTokens?: { value?: unknown }; cacheHitRate?: { value?: unknown } }
        modelUsage?: {
          totalUsage?: { totalTokens?: unknown }
          xTime?: unknown
          modelSummaryList?: unknown
          modelDataList?: unknown
        }
      }
    | undefined

  const usage = data?.modelUsage ?? {}
  const times = Array.isArray(usage.xTime) ? (usage.xTime as string[]) : []
  const details = Array.isArray(usage.modelDataList)
    ? (usage.modelDataList as { modelName?: string; totalTokensUsage?: unknown }[])
    : []

  // One total per bucket, the sum across models.
  const summed = new Array<number>(times.length).fill(0)
  for (const detail of details) {
    const series = Array.isArray(detail.totalTokensUsage) ? (detail.totalTokensUsage as (number | null)[]) : []
    for (let i = 0; i < summed.length; i++) summed[i]! += Number(series[i] ?? 0)
  }
  const buckets = times.map((time, index) => ({ time, tokens: summed[index] ?? 0 }))

  const models = Array.isArray(usage.modelSummaryList)
    ? (usage.modelSummaryList as { modelName?: string; totalTokens?: unknown }[])
        .map((m) => ({ name: String(m.modelName ?? "?"), tokens: Number(m.totalTokens ?? 0) }))
        .sort((a, b) => b.tokens - a.tokens)
    : []

  const reportedTotal = Number(data?.summary?.totalTokens?.value)
  const totalTokens = Number.isFinite(reportedTotal)
    ? reportedTotal
    : typeof usage.totalUsage?.totalTokens === "number"
      ? usage.totalUsage.totalTokens
      : buckets.reduce((total, bucket) => total + bucket.tokens, 0)

  // Cache rate and raw input totals come per model; the ratio needs both.
  let inputTokens = 0
  let cachedInputTokens = 0
  for (const detail of details as { inputTokensUsage?: unknown; cachedInputTokensUsage?: unknown }[]) {
    const input = Array.isArray(detail.inputTokensUsage) ? (detail.inputTokensUsage as (number | null)[]) : []
    const cached = Array.isArray(detail.cachedInputTokensUsage) ? (detail.cachedInputTokensUsage as (number | null)[]) : []
    for (const value of input) inputTokens += Number(value ?? 0)
    for (const value of cached) cachedInputTokens += Number(value ?? 0)
  }
  const reportedRate = Number(data?.summary?.cacheHitRate?.value)
  const cacheHitRate = Number.isFinite(reportedRate)
    ? reportedRate
    : inputTokens > 0
      ? cachedInputTokens / inputTokens
      : undefined

  return {
    totalTokens,
    granularity: data?.granularity === "DAY" ? "daily" : "hourly",
    buckets,
    models,
    cacheHitRate,
    inputTokens,
    cachedInputTokens,
  }
}

/** Today since local midnight, padded to the full 24-hour axis. */
async function fetchToday(config: GlmConfig): Promise<UsageRange> {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  const range = await fetchUsageBetween(config, start, end)
  const padHours = 24 - range.buckets.length
  if (padHours <= 0) return range
  const extra = Array.from({ length: padHours }, (_, i) => {
    const at = new Date(start.getFullYear(), start.getMonth(), start.getDate(), range.buckets.length + i)
    return { time: formatLocal(at), tokens: 0 }
  })
  return { ...range, buckets: [...range.buckets, ...extra] }
}

/** The last `days` days, including today. */
async function fetchUsage(config: GlmConfig, days: number): Promise<UsageRange> {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  return fetchUsageBetween(config, start, end)
}

/** Adds ranges up by bucket index: the account total the overview shows. */
function sumUsage(ranges: (UsageRange | undefined)[]): UsageRange | undefined {
  const present = ranges.filter((range): range is UsageRange => range !== undefined)
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]

  const length = Math.max(...present.map((range) => range.buckets.length))
  const buckets: UsageBucket[] = []
  for (let i = 0; i < length; i++) {
    const time = present.find((range) => range.buckets[i])?.buckets[i]?.time ?? ""
    const tokens = present.reduce((total, range) => total + (range.buckets[i]?.tokens ?? 0), 0)
    buckets.push({ time, tokens })
  }

  const merged = new Map<string, number>()
  for (const range of present) for (const model of range.models) merged.set(model.name, (merged.get(model.name) ?? 0) + model.tokens)
  const models = [...merged.entries()].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens)

  const inputTokens = present.reduce((total, range) => total + (range.inputTokens ?? 0), 0)
  const cachedInputTokens = present.reduce((total, range) => total + (range.cachedInputTokens ?? 0), 0)

  return {
    totalTokens: present.reduce((total, range) => total + range.totalTokens, 0),
    granularity: present[0]!.granularity,
    buckets,
    models,
    cacheHitRate: inputTokens > 0 ? cachedInputTokens / inputTokens : undefined,
    inputTokens,
    cachedInputTokens,
  }
}

/** One plan's config: the query's overrides on top of the account-level defaults. */
function planConfigOf(config: GlmConfig, query: PlanQuery): GlmConfig {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    organization: query.organization ?? config.organization,
    project: query.project ?? config.project,
    planType: query.planType ?? config.planType,
  }
}

/** One plan's quota and usage; failures become per-plan status, never a throw. */
async function fetchPlan(
  config: GlmConfig,
  query: PlanQuery,
): Promise<{ plan: PlanQuota; fingerprint?: string; usageType: number }> {
  const planConfig = planConfigOf(config, query)
  const base = { label: query.label, planType: planConfig.planType }
  try {
    const [quota, usageToday, usage7d, usage30d] = await Promise.all([
      fetchQuota(planConfig),
      fetchToday(planConfig).catch(() => undefined),
      fetchUsage(planConfig, 7).catch(() => undefined),
      fetchUsage(planConfig, 30).catch(() => undefined),
    ])
    return {
      fingerprint: quota.fingerprint,
      usageType: usageTypeOf(planConfig.planType),
      plan: {
        ...base,
        status: "ok",
        level: quota.level,
        limits: quota.limits,
        usageToday,
        usage7d,
        usage30d,
      },
    }
  } catch (cause) {
    const empty = cause instanceof EmptyQuotaError
    return {
      usageType: usageTypeOf(planConfig.planType),
      plan: {
        ...base,
        status: empty ? "empty" : "error",
        message: empty ? undefined : cause instanceof Error ? cause.message : String(cause),
        hint: empty ? "org-project" : undefined,
        limits: [],
      },
    }
  }
}

/** Fetches everything the panel shows. Never rejects: failures become a status. */
export async function fetchSnapshot(rawOptions: unknown): Promise<Snapshot> {
  const options = readOptions(rawOptions)
  const fetchedAt = Date.now()
  try {
    const config = resolveConfig(options)
    if ("error" in config) return { status: "no-key", plans: [], limits: [], fetchedAt }

    const queries = planQueries(options)
    const results = await Promise.all(queries.map((query) => fetchPlan(config, query)))

    // The same plan often answers for several type values; keep the first hit.
    // Only auto discovery dedupes — an explicit `plans` list is taken as-is.
    const seen = options.plans ? undefined : new Set<string>()
    const anyOk = results.some((result) => result.plan.status === "ok")
    const plans = results
      .filter((result, index) => {
        if (seen) {
          const fingerprint = result.fingerprint
          if (fingerprint) {
            if (seen.has(fingerprint)) return false
            seen.add(fingerprint)
          }
        }
        const query = queries[index]!
        return query.explicit || result.plan.status === "ok" || (!anyOk && result.plan.status === "error")
      })
      .map((result) => result.plan)

    const okPlans = plans.filter((plan) => plan.status === "ok")
    const status: SnapshotStatus =
      okPlans.length > 0 ? "ok" : plans.some((plan) => plan.status === "error") ? "error" : "empty"

    return {
      status,
      message: status === "error" ? plans.find((plan) => plan.status === "error")?.message : undefined,
      hint: status === "empty" ? "org-project" : undefined,
      plans,
      limits: okPlans.flatMap((plan) => plan.limits),
      usageToday: sumUsage(plans.map((plan) => plan.usageToday)),
      usage7d: sumUsage(plans.map((plan) => plan.usage7d)),
      usage30d: sumUsage(plans.map((plan) => plan.usage30d)),
      fetchedAt,
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { status: "error", message, plans: [], limits: [], fetchedAt }
  }
}
