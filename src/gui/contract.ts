import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/**
 * Window → main bridge. main implements it (`ctx.provide`) with the BigModel
 * client; windows call it with `ctx.main`. Values cross as JSON, so the schemas
 * stay permissive and the window casts to the shared types.
 */
export const GlmQuota = Ipc.define({
  id: "opencode-glm-plugin.quota",
  methods: {
    /** The cached snapshot, fetching one when the cache is older than ~90s. */
    snapshot: { output: Schema.Unknown },
    /** Forces a fetch, bypassing the throttle. */
    refresh: { output: Schema.Unknown },
  },
})
