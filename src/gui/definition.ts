import { Plugin } from "@opencode/plugin/gui"
import en from "./i18n/en"
import zh from "./i18n/zh"

/**
 * The plugin's declarations: copy only. (2.3.2 has no `icons` field; the panel
 * and shell use the app's own catalog icons.)
 */
export const definition = Plugin.define({
  i18n: { en, zh, zht: zh },
})
