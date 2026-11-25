import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * BigModel (GLM Coding Plan) usage endpoints and response shapes.
 * Runs only in the desktop app's main process: plain Node fetch, no CORS.
 */

/** Options a user may set on the plugin entry in `opencode.json`. */
export interface GlmOptions {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly organization?: string
  readonly project?: string
  /** Plan type query for reformed credit plans: 1 personal, 2 team. */
  readonly planType?: number
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
  readonly totalCalls: number
  readonly granularity: string
  readonly buckets: readonly UsageBucket[]
  readonly models: readonly { readonly name: string; readonly tokens: number }[]
}

export type SnapshotStatus = "ok" | "no-key" | "error" | "empty"

export interface Snapshot {
  readonly status: SnapshotStatus
  readonly message?: string
  /** Extra guidance the panel renders for `empty` (new credit plans) states. */
  readonly hint?: "org-project"
  readonly level?: string
  readonly limits: readonly QuotaLimit[]
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
  return {
    apiKey: str(o.apiKey),
    baseUrl: str(o.baseUrl),
    organization: str(o.organization),
    project: str(o.project),
    planType: num(o.planType),
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
async function fetchQuota(config: GlmConfig): Promise<{ level?: string; limits: QuotaLimit[] }> {
  const query = config.planType === undefined ? "" : `?type=${config.planType}`
  const data = (await getJson(config, `${config.baseUrl}/api/monitor/usage/quota/limit${query}`)) as
    | { level?: string; limits?: unknown }
    | undefined

  const raw = Array.isArray(data?.limits) ? (data!.limits as Record<string, unknown>[]) : []
  if (raw.length === 0) throw new EmptyQuotaError()

  const limits = raw.map((entry, index) => toLimit(entry, index))
  return { level: typeof data?.level === "string" ? data.level : undefined, limits }
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

/** `/api/monitor/usage/model-usage`: buckets, totals and a per-model breakdown. */
async function fetchUsage(config: GlmConfig, days: number): Promise<UsageRange> {
  const end = new Date()
  const start = new Date(end.getTime() - days * 86_400_000)
  return fetchUsageBetween(config, start, end, 96)
}

/** Today since local midnight; the chart grows across a fixed 24-bucket day. */
async function fetchToday(config: GlmConfig): Promise<UsageRange> {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  return fetchUsageBetween(config, start, end, 0)
}

async function fetchUsageBetween(config: GlmConfig, start: Date, end: Date, downsampleMax: number): Promise<UsageRange> {
  const query = `startTime=${encodeURIComponent(formatLocal(start))}&endTime=${encodeURIComponent(formatLocal(end))}`
  const data = (await getJson(config, `${config.baseUrl}/api/monitor/usage/model-usage?${query}`)) as
    | {
        x_time?: unknown
        tokensUsage?: unknown
        totalUsage?: unknown
        modelSummaryList?: unknown
        granularity?: unknown
      }
    | undefined

  const times = Array.isArray(data?.x_time) ? (data!.x_time as string[]) : []
  const tokens = Array.isArray(data?.tokensUsage) ? (data!.tokensUsage as number[]) : []
  const buckets = times.map((time, index) => ({ time, tokens: Number(tokens[index] ?? 0) }))

  const totals = (data?.totalUsage ?? {}) as { totalTokensUsage?: number; totalModelCallCount?: number }
  const models = Array.isArray(data?.modelSummaryList)
    ? (data!.modelSummaryList as { modelName?: string; totalTokens?: number }[])
        .map((m) => ({ name: String(m.modelName ?? "?"), tokens: Number(m.totalTokens ?? 0) }))
        .sort((a, b) => b.tokens - a.tokens)
    : []

  const sum = buckets.reduce((total, bucket) => total + bucket.tokens, 0)
  return {
    totalTokens: typeof totals.totalTokensUsage === "number" ? totals.totalTokensUsage : sum,
    totalCalls: typeof totals.totalModelCallCount === "number" ? totals.totalModelCallCount : 0,
    granularity: typeof data?.granularity === "string" ? data.granularity : "hourly",
    buckets: downsampleMax > 0 ? downsample(buckets, downsampleMax) : buckets,
    models,
  }
}

/** Keeps the sparkline light on long ranges by merging buckets into at most `max` slices. */
function downsample(buckets: UsageBucket[], max: number): UsageBucket[] {
  if (buckets.length <= max) return buckets
  const groupSize = Math.ceil(buckets.length / max)
  const merged: UsageBucket[] = []
  for (let i = 0; i < buckets.length; i += groupSize) {
    const group = buckets.slice(i, i + groupSize)
    merged.push({
      time: group[0]!.time,
      tokens: group.reduce((total, bucket) => total + bucket.tokens, 0),
    })
  }
  return merged
}

/** Fetches everything the panel shows. Never rejects: failures become a status. */
export async function fetchSnapshot(rawOptions: unknown): Promise<Snapshot> {
  const options = readOptions(rawOptions)
  const fetchedAt = Date.now()
  try {
    const config = resolveConfig(options)
    if ("error" in config)
      return { status: "no-key", limits: [], fetchedAt }

    const [quota, usageToday, usage7d, usage30d] = await Promise.all([
      fetchQuota(config),
      fetchToday(config).catch(() => undefined),
      fetchUsage(config, 7).catch(() => undefined),
      fetchUsage(config, 30).catch(() => undefined),
    ])

    return {
      status: "ok",
      level: quota.level,
      limits: quota.limits,
      usageToday,
      usage7d,
      usage30d,
      fetchedAt,
    }
  } catch (cause) {
    if (cause instanceof EmptyQuotaError)
      return { status: "empty", hint: "org-project", limits: [], fetchedAt }
    const message = cause instanceof Error ? cause.message : String(cause)
    return { status: "error", message, limits: [], fetchedAt }
  }
}
