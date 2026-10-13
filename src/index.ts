import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "opencode-message-rail",
  // All behaviour lives in the TUI half (./tui), auto-discovered via package.json exports["./tui"].
  // The server definition no longer accepts a `tui` marker.
  setup() {},
});
