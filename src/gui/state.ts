import { createSignal } from "solid-js"
import type { Snapshot } from "./bigmodel"

/**
 * The window-side snapshot store, shared by the panel, the + menu item and the
 * titlebar pill. Module-scope Solid signals: one store per desktop window.
 * The main process evaluates this module too, but only window code touches it —
 * there solid-js is an inert placeholder, and these calls stay harmless.
 */

const [snapshot, setSnapshot] = createSignal<Snapshot | undefined>(undefined)
const [busy, setBusy] = createSignal(false)

let client: { snapshot(): Promise<unknown>; refresh(): Promise<unknown> } | undefined
let timer: ReturnType<typeof setInterval> | undefined

export const quotaState = {
  snapshot,
  busy,

  /** Wires the store to the Ipc client; call once from the window setup. */
  attach(next: { snapshot(): Promise<unknown>; refresh(): Promise<unknown> }) {
    client = next
  },

  /** Fetches through main; `force` bypasses the throttle in main. */
  pull(force: boolean) {
    if (!client || busy()) return
    setBusy(true)
    const call = force ? client.refresh() : client.snapshot()
    call
      .then((value) => setSnapshot(value as Snapshot))
      .catch(() => {})
      .finally(() => setBusy(false))
  },

  /** Initial pull plus the auto-refresh loop. */
  start(intervalMs: number) {
    this.pull(false)
    if (!timer) timer = setInterval(() => this.pull(false), intervalMs)
  },

  stop() {
    if (timer) clearInterval(timer)
    timer = undefined
  },
}
