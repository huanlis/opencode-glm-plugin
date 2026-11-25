import { Plugin } from "@opencode/plugin/gui"
import { definition } from "./gui/definition"
import { main } from "./gui/main"
import { setup } from "./gui/window"

/**
 * The `./gui-experimental` entry. Both processes evaluate this file: windows run
 * `setup`, the desktop app's main process runs `main`.
 */
export default Plugin.define({ ...definition, setup, main })
