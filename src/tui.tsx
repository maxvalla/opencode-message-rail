/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui";
import type { Context } from "@opencode-ai/plugin/tui/context";

export default Plugin.define({
  id: "opencode-message-rail",

  setup(context: Context) {
    // TODO(tui): read context.options -> settings, create the "prefs" storage store, build the rail
    // controller, register the "app" and "sidebar.content" slots and the keymap layer here.
    return () => {
      // TODO(tui): dispose the app/sidebar slots and the rail controller.
    };
  },
});
