import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

// Builds ./dist/gui-experimental.cjs from ./src/gui.tsx: one CommonJS file that
// keeps the app's shared modules (solid-js, effect, @opencode/*) external.
export default defineConfig({
  plugins: [gui()],
})
