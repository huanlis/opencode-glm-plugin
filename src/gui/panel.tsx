import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import type { definition } from "./definition"
import type { QuotaLimit, UsageBucket, UsageRange } from "./bigmodel"
import { quotaState } from "./state"
import { PANEL_WIDTH, formatCountdown, formatTokens, isLimited, tierColor, tierOf } from "./view"

/** The right-side "GLM 额度" panel: plan limits, limit status, 7/30-day usage. */

const STALE_MS = 60_000

export function QuotaPanel() {
  const ctx = usePlugin<typeof definition>()
  const zh = () => ctx.locale.locale().startsWith("zh")

  /** Pin the compact width; the host's stored value (e.g. recorded from a drag)
   * wins over `Panel.width`, so correct it whenever it is missing or larger. */
  const ensureWidth = () => {
    const stored = ctx.layout.side.width("quota")
    if (stored === undefined || stored > PANEL_WIDTH) ctx.layout.side.resize("quota", PANEL_WIDTH)
  }

  // Ticks every second so reset countdowns stay live while the panel shows.
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(tick))

    ensureWidth()

    // A snapshot opened after a while on screen refreshes right away.
    const snap = quotaState.snapshot()
    if (!snap || Date.now() - snap.fetchedAt > STALE_MS) quotaState.pull(true)
  })

  const snapshot = () => quotaState.snapshot()
  const limited = () => isLimited(snapshot())

  return (
    <div class="glmq">
      <header class="glmq-head">
        <span class="glmq-title">{ctx.t("panel.title")}</span>
        <Show when={snapshot()?.level}>
          <span class="glmq-level">{snapshot()!.level}</span>
        </Show>
        <Show when={limited()}>
          <span class="glmq-flag">{ctx.t("state.limited")}</span>
        </Show>
        <button
          type="button"
          class="glmq-refresh"
          title={ctx.t("panel.refresh")}
          aria-label={ctx.t("panel.refresh")}
          disabled={quotaState.busy()}
          onClick={() => quotaState.pull(true)}
        >
          <ctx.ui.Icon name="refresh" size="small" />
        </button>
      </header>

      <Show when={snapshot()} fallback={<StatusCard kind="loading" />}>
        {(snap) => (
          <Show when={snap().status === "ok"} fallback={<StatusCard kind={snap().status} message={snap().message} />}>
            <div class="glmq-body">
              <section class="glmq-card">
                <div class="glmq-card-title">{ctx.t("section.quota")}</div>
                <For each={snap().limits}>{(limit) => <LimitRow limit={limit} now={now()} zh={zh()} />}</For>
              </section>

              <UsageSection
                title={ctx.t("section.today")}
                range={snap().usageToday}
                zh={zh()}
                chart={{ minSpan: 24, hourTicks: true }}
              />
              <UsageSection title={ctx.t("section.7d")} range={snap().usage7d} zh={zh()} />
              <UsageSection title={ctx.t("section.30d")} range={snap().usage30d} zh={zh()} />

              <footer class="glmq-foot">
                {ctx.t("foot.updated", { time: formatClock(snap().fetchedAt) })} · {ctx.t("foot.auto")}
              </footer>
            </div>
          </Show>
        )}
      </Show>
    </div>
  )
}

function StatusCard(props: { kind: string; message?: string }) {
  const ctx = usePlugin<typeof definition>()
  const hint = () => {
    if (props.kind === "no-key") return ctx.t("state.noKeyHint")
    if (props.kind === "empty") return ctx.t("state.emptyHint")
    return undefined
  }
  const text = () => {
    if (props.kind === "loading") return ctx.t("state.loading")
    if (props.kind === "no-key") return ctx.t("state.noKey")
    if (props.kind === "empty") return ctx.t("state.empty")
    return ctx.t("state.error")
  }
  return (
    <div class="glmq-card">
      <div class="glmq-status" classList={{ "glmq-status-error": props.kind === "error" }}>
        <div class="glmq-status-title">{text()}</div>
        <Show when={props.message}>
          <div class="glmq-status-detail">{props.message}</div>
        </Show>
        <Show when={hint()}>
          <div class="glmq-status-detail">{hint()}</div>
        </Show>
      </div>
    </div>
  )
}

function LimitRow(props: { limit: QuotaLimit; now: number; zh: boolean }) {
  const ctx = usePlugin<typeof definition>()
  const pct = () => props.limit.percentage
  const tier = () => tierOf(pct())
  const color = () => tierColor(tier()) ?? "var(--v2-icon-icon-accent)"
  const reset = () => {
    const at = props.limit.nextResetTime
    if (!at) return undefined
    return ctx.t("state.resetIn", { time: formatCountdown(at - props.now, props.zh) })
  }
  const amounts = () => {
    const used = props.limit.currentValue
    const total = props.limit.usage
    const left = props.limit.remaining
    const parts: string[] = []
    if (used !== undefined && total !== undefined && total > 0)
      parts.push(`${ctx.t("state.used")} ${formatTokens(used, props.zh)} / ${formatTokens(total, props.zh)}`)
    else if (left !== undefined && total !== undefined && total > 0)
      parts.push(`${ctx.t("state.remaining")} ${formatTokens(left, props.zh)}`)
    else if (pct() !== undefined) parts.push(ctx.t("state.freePct", { pct: 100 - Math.round(pct()!) }))
    return parts.join(" · ")
  }
  const sub = amounts

  return (
    <div class="glmq-limit">
      <div class="glmq-limit-head">
        <span class="glmq-limit-name">{ctx.t(`limit.${props.limit.kind}`)}</span>
        <span class="glmq-limit-pct" style={{ color: color() }}>
          {pct() !== undefined ? ctx.t("state.usedPct", { pct: Math.round(pct()!) }) : "—"}
        </span>
      </div>
      <div class="glmq-bar" role="progressbar" aria-valuenow={pct() !== undefined ? Math.round(pct()!) : undefined}>
        <div
          class="glmq-fill"
          style={{ width: `${Math.min(100, Math.max(0, pct() ?? 0))}%`, background: color() }}
        />
      </div>
      <div class="glmq-sub">
        <span>{sub() || " "}</span>
        <Show when={reset()}>
          <span>{reset()}</span>
        </Show>
      </div>
    </div>
  )
}

function UsageSection(props: {
  title: string
  range: UsageRange | undefined
  zh: boolean
  chart?: { minSpan?: number; hourTicks?: boolean }
}) {
  const ctx = usePlugin<typeof definition>()
  const has = () => !!props.range && (props.range.totalTokens > 0 || props.range.totalCalls > 0)
  const byDay = () => props.range?.granularity === "daily"
  return (
    <section class="glmq-card">
      <div class="glmq-card-row">
        <div class="glmq-card-title">{props.title}</div>
        <Show when={has()}>
          <span class="glmq-gran">{byDay() ? ctx.t("chart.byDay") : ctx.t("chart.byHour")}</span>
        </Show>
      </div>
      <Show
        when={has()}
        fallback={<div class="glmq-none">{ctx.t("usage.empty")}</div>}
      >
        <div class="glmq-totals">
          <div class="glmq-total">
            <b>{formatTokens(props.range!.totalTokens, props.zh)}</b>
            <span>{ctx.t("usage.tokens")}</span>
          </div>
          <div class="glmq-total">
            <b>{formatCount(props.range!.totalCalls)}</b>
            <span>{ctx.t("usage.calls")}</span>
          </div>
        </div>
        <Chart buckets={props.range!.buckets} zh={props.zh} span={props.chart} />
        <Show when={props.range!.models.length > 0}>
          <div class="glmq-models">
            <div class="glmq-models-title">{ctx.t("usage.models")}</div>
            <For each={props.range!.models.slice(0, 5)}>
              {(model) => (
                <ModelRow name={model.name} tokens={model.tokens} total={props.range!.totalTokens} zh={props.zh} />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  )
}

/**
 * Bars with axes: horizontal gridlines carry y tick labels (peak, mid, 0), the
 * row under the plot carries x time ticks, so the magnitude is readable.
 */
function Chart(props: {
  buckets: readonly UsageBucket[]
  zh: boolean
  span?: { minSpan?: number; hourTicks?: boolean }
}) {
  const count = () => props.buckets.length
  const max = () => Math.max(1, ...props.buckets.map((bucket) => bucket.tokens))
  const viewWidth = () => Math.max(count(), props.span?.minSpan ?? 1)

  const yTicks = () => [
    { top: "0%", label: formatTokens(max(), props.zh) },
    { top: "50%", label: formatTokens(max() / 2, props.zh) },
    { top: "100%", label: "0" },
  ]

  const xTicks = () => {
    const n = count()
    if (n === 0) return []
    const positions =
      n < 8 ? (n === 1 ? [0] : [0, n - 1]) : [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1]
    return [...new Set(positions)].map((index) => ({
      index,
      label: tickLabel(props.buckets[index]!.time, props.span?.hourTicks),
    }))
  }

  return (
    <div class="glmq-chart">
      <div class="glmq-plot">
        <div class="glmq-gutter">
          <For each={yTicks()}>
            {(tick) => (
              <span class="glmq-ylabel" style={{ top: tick.top }}>
                {tick.label}
              </span>
            )}
          </For>
        </div>
        <div class="glmq-area">
          <For each={yTicks()}>
            {(tick) => <span class="glmq-gridline" style={{ top: tick.top }} />}
          </For>
          <svg class="glmq-bars" viewBox={`0 0 ${viewWidth()} 100`} preserveAspectRatio="none" aria-hidden="true">
            <For each={props.buckets}>
              {(bucket, index) => {
                const height = () => Math.max(bucket.tokens > 0 ? 1.5 : 0, (bucket.tokens / max()) * 97)
                return (
                  <rect x={index() + 0.09} y={100 - height()} width={0.82} height={height()} rx={0.25} fill="currentColor">
                    <title>{`${bucket.time} · ${formatTokens(bucket.tokens, props.zh)}`}</title>
                  </rect>
                )
              }}
            </For>
          </svg>
        </div>
      </div>
      <div class="glmq-xlabels">
        <For each={xTicks()}>{(tick) => <span>{tick.label}</span>}</For>
      </div>
    </div>
  )
}

/** Hour ticks read `"2026-11-22 13:00"` as `"13:00"`; day ticks as `"11/22"`. */
function tickLabel(time: string, hourTicks: boolean | undefined): string {
  if (hourTicks) {
    const hour = time.slice(11, 16)
    return hour || shortDate(time)
  }
  return shortDate(time)
}

function ModelRow(props: { name: string; tokens: number; total: number; zh: boolean }) {
  const fill = () => (props.total > 0 ? Math.max(2, (props.tokens / props.total) * 100) : 0)
  return (
    <div class="glmq-model">
      <div class="glmq-model-head">
        <span class="glmq-model-name" title={props.name}>
          {props.name}
        </span>
        <span class="glmq-model-tokens">{formatTokens(props.tokens, props.zh)}</span>
      </div>
      <span class="glmq-model-bar">
        <span class="glmq-model-fill" style={{ width: `${fill()}%` }} />
      </span>
    </div>
  )
}

/** `"2026-11-16 00:00"` → `"11/16"`. */
function shortDate(time: string): string {
  const day = time.slice(5, 10)
  return day.includes("-") ? day.replace("-", "/") : day
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 100000 ? "compact" : "standard" }).format(value)
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}
