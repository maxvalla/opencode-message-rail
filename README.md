# opencode-message-rail

OpenCode 2 TUI plugin: a right-edge message anchor rail with per-turn ticks, chevrons, a dwell-hover preview card and click-to-jump.

Requires OpenCode **≥ 2.0.19**.

## Install (local file plugin)

Add a `file:` entry to `~/.config/opencode/opencode.json`:

```json
{
  "plugins": [
    "file:/abs/path/to/opencode-message-rail"
  ]
}
```

Then restart the TUI. Toggle with `Alt+R`. Previous / next turn: `Alt+[` / `Alt+]`.

Do not use `opencode plugin add` for a local directory — it only accepts npm/Git specs.

## Commands

- `npm install`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Notes

On 2.0.19 the rail paints through `session.composer.top` (not `app` / `sidebar.content`). Pointer hit-testing uses the rail geometry plus a Yoga mouse layer on the overlay.
