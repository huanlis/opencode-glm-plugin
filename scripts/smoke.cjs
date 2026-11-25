// Smoke test: evaluate dist/gui-experimental.cjs the way the desktop app does,
// with stub modules, then run the real main() data path end to end.
const fs = require("fs")
const path = require("path")

const code = fs.readFileSync(path.join(__dirname, "..", "dist", "gui-experimental.cjs"), "utf8")

function makeInert(name) {
  const target = function () {}
  return new Proxy(target, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => `[inert ${name}]`
      if (key === "then") return undefined
      if (key === "createSignal") return (v) => [() => v, () => {}]
      return makeInert(`${name}.${String(key)}`)
    },
    apply() {
      return makeInert(`${name}()`)
    },
    construct() {
      return makeInert(`new ${name}`)
    },
    set() {
      return true
    },
  })
}

const registry = (id) => ({ kind: "registry", id })
const guiStub = {
  Plugin: { define: (p) => p },
  Ipc: { define: (spec) => ({ kind: "ipc", spec }) },
  Contract: { define: (_v, id) => ({ kind: "contract", id }) },
  Registry: { define: registry },
  Panel: registry("panel"),
  MenuItem: registry("menu-item"),
  Style: registry("style"),
  TitlebarItem: registry("titlebar-item"),
  Command: registry("command"),
  SettingsPage: registry("settings-page"),
  usePlugin: () => {
    throw new Error("usePlugin outside contribution")
  },
}
const solidStub = {
  createSignal: (v) => {
    let value = v
    return [
      () => value,
      (next) => {
        value = typeof next === "function" ? next(value) : next
      },
    ]
  },
  onCleanup: () => {},
  onMount: () => {},
  createEffect: () => {},
  createMemo: (fn) => fn,
  For: () => null,
  Show: () => null,
}

const modules = {
  "solid-js": solidStub,
  "solid-js/web": makeInert("solid-js/web"),
  "solid-js/store": makeInert("solid-js/store"),
  effect: { Schema: new Proxy({}, { get: () => ({}) }) },
  "@opencode/plugin/gui": guiStub,
  electron: makeInert("electron"),
}

const requireShim = (name) => {
  if (modules[name]) return modules[name]
  if (name.startsWith("node:")) return require(name)
  throw new Error(`unexpected require: ${name}`)
}

const mod = { exports: {} }
// eslint-disable-next-line no-new-func
new Function("require", "module", "exports", code)(requireShim, mod, mod.exports)

const plugin = mod.exports.default
console.log("default export keys:", Object.keys(plugin))
console.log("setup:", typeof plugin.setup, "main:", typeof plugin.main)
console.log("i18n locales:", Object.keys(plugin.i18n ?? {}))

// ---- Real main() flow ----
async function testMain() {
  let provided = null
  const ctx = {
    options: {},
    provide(_token, impl) {
      provided = impl
      return { changed() {}, emit() {}, dispose() {} }
    },
  }
  const cleanup = plugin.main(ctx)
  console.log("main returned cleanup:", typeof cleanup)
  const snap = await provided.snapshot()
  console.log("snapshot status:", snap.status, "| level:", snap.level)
  console.log(
    "limits:",
    snap.limits.map((l) => `${l.kind}=${l.percentage === undefined ? "?" : Math.round(l.percentage) + "%"}${l.nextResetTime ? " reset@" + new Date(l.nextResetTime).toISOString() : ""}`).join(" | "),
  )
  for (const [label, range] of [["today", snap.usageToday], ["7d", snap.usage7d], ["30d", snap.usage30d]]) {
    if (!range) {
      console.log(`usage ${label}: unavailable`)
      continue
    }
    console.log(
      `usage ${label}: tokens=${range.totalTokens} calls=${range.totalCalls} buckets=${range.buckets.length} (${range.granularity}) models=${range.models.map((m) => m.name).join(",")}`,
    )
  }
  const forced = await provided.refresh()
  console.log("refresh status:", forced.status, "fetchedAt age ms:", Date.now() - forced.fetchedAt)
}

// ---- Fake window setup flow ----
function testSetup() {
  const contributions = []
  const ipc = { snapshot: async () => ({ status: "ok", limits: [], fetchedAt: Date.now() }), refresh: async () => ({}) }
  const fakeSession = { id: "ses_test", server: { id: "sidecar" } }
  const ctx = {
    id: "opencode-glm-plugin",
    desktop: {},
    options: {},
    main: () => ipc,
    sessions: { current: () => fakeSession },
    layout: {
      state: () => "closed",
      open: (key, session) => contributions.push(`open ${key} for ${session.id}`),
      side: {
        width: () => undefined,
        resize: (panel, width) => contributions.push(`resize ${panel} → ${width}px`),
      },
    },
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    add(_registry, item) {
      contributions.push(typeof item === "function" ? item() : item)
      return () => {}
    },
  }
  plugin.setup(ctx)
  const kinds = contributions.map((c) => (c && c.region ? "Panel" : c && c.menu ? "MenuItem" : c && c.label !== undefined ? "TitlebarItem" : typeof c === "string" ? "string" : typeof c))
  console.log("setup contributions:", JSON.stringify(kinds))
  const panel = contributions.find((c) => c && c.region)
  console.log("panel:", JSON.stringify({ id: panel.id, region: panel.region, width: panel.width, tabs: panel.list({ open: ["quota"] }).map((t) => t.id) }))
  const pill = contributions.find((c) => c && c.label !== undefined)
  console.log("titlebar pill:", JSON.stringify({ label: pill.label, icon: pill.icon, busy: pill.busy }))
  pill.run()
  console.log("pill run →", contributions.filter((c) => typeof c === "string").join("; ") || "(no layout.open call)")
}

testSetup()
testMain()
  .then(() => {
    console.log("SMOKE TEST OK")
    process.exit(0)
  })
  .catch((error) => {
    console.error("SMOKE TEST FAILED:", error)
    process.exit(1)
  })
