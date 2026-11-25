import { Plugin } from "@opencode/plugin"

/**
 * The server half of the plugin. It carries the plugin id the desktop GUI takes,
 * and nothing else: all the work happens in `./gui-experimental`.
 */
export default Plugin.define({
  id: "opencode-glm-plugin",
  setup() {},
})
