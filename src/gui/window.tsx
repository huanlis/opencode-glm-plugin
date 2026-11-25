import { onCleanup } from "solid-js"
import { Panel, Style, TitlebarItem, MenuItem, type PanelTab, type Plugin } from "@opencode/plugin/gui"
import type { definition } from "./definition"
import { GlmQuota } from "./contract"
import { quotaState } from "./state"
import { QuotaPanel } from "./panel"
import { PANEL_WIDTH, primaryPercentage } from "./view"
import css from "./panel.css?inline"

/** The window half: the side panel, the + menu item and the titlebar pill. */

const REFRESH_MS = 5 * 60_000
const TAB_ID = "quota"

/**
 * The panel keeps a compact width. A stored width wins in the host — including
 * one the host recorded for us while the divider was dragged — so correct any
 * missing or larger value; a user's narrower drag stays.
 */
function ensureWidth(ctx: { layout: { side: { width(panel: string): number | undefined; resize(panel: string, width: number): void } } }) {
  const stored = ctx.layout.side.width(TAB_ID)
  if (stored === undefined || stored > PANEL_WIDTH) ctx.layout.side.resize(TAB_ID, PANEL_WIDTH)
}

export const setup: Plugin.Setup<typeof definition> = (ctx) => {
  if (!ctx.desktop) return

  quotaState.attach(ctx.main(GlmQuota))
  quotaState.start(REFRESH_MS)
  onCleanup(() => quotaState.stop())

  ensureWidth(ctx)

  ctx.add(Style, css)

  const openPanel = () => {
    const session = ctx.sessions.current()
    if (session) ctx.layout.open(`${ctx.id}:${TAB_ID}`, session)
  }

  const tab: PanelTab = {
    id: TAB_ID,
    get title() {
      return ctx.t("panel.title")
    },
    closable: "compact",
  }

  ctx.add(Panel, {
    id: TAB_ID,
    region: "side",
    width: PANEL_WIDTH,
    list: (input) => (input.open.includes(TAB_ID) ? [tab] : []),
    // The reliable moment to correct the width: the tab is on screen. The
    // panel's own mount does the same, for a reload with the tab already open.
    focus: () => ensureWidth(ctx),
    render: () => <QuotaPanel />,
  })

  ctx.add(MenuItem, (): MenuItem => {
    const session = ctx.sessions.current()
    const pct = primaryPercentage(quotaState.snapshot())
    return {
      menu: "session.panel",
      id: "open",
      get title() {
        return ctx.t("menu.open")
      },
      icon: "status",
      ...(pct !== undefined ? { description: ctx.t("state.usedPct", { pct: Math.round(pct) }) } : {}),
      opened: !!session && ctx.layout.state(`${ctx.id}:${TAB_ID}`, session) !== "closed",
      run: openPanel,
    }
  })

  ctx.add(TitlebarItem, (): TitlebarItem | undefined => {
    const snap = quotaState.snapshot()
    const pct = primaryPercentage(snap)
    if (pct === undefined) {
      // A spinner while the very first fetch runs; nothing when it failed.
      return quotaState.busy() && !snap
        ? { id: "quota", label: ctx.t("pill.loading"), icon: "status", busy: true, run: openPanel }
        : undefined
    }
    return {
      id: "quota",
      label: ctx.t("pill.label", { pct: Math.round(pct) }),
      icon: "status",
      busy: quotaState.busy(),
      run: openPanel,
    }
  })
}
