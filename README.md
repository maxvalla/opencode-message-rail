# opencode-message-rail

OpenCode 2 TUI plugin: a right-edge message anchor rail with per-turn ticks, chevrons, a dwell-hover preview card and click-to-jump.

Requires OpenCode **≥ 2.3.2** (TUI plugin API 2.3.2, OpenTUI **≥ 0.8.4**).

Targets are pinned to the *floor* the host guarantees: the `@opentui/*` peer range is the
one `@opencode/plugin@2.3.2` declares, not the newest npm release, and every newer host
capability is duck-typed so a build without it degrades instead of throwing.

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

`npm test` runs with `--conditions=browser`: solid-js's `node` export condition resolves to
its SSR build, where `createMemo` is not reactive and the controller tests would assert
against a frozen view.

## Notes

- The rail paints through `session.composer.top` — still the only slot that paints plugin
  JSX outside the composer's flow, and still the same ten slot paths as 2.0.19. The overlay
  is a 0×0 out-of-flow host with an absolutely positioned rail, mutated on a 150 ms timer;
  `slot.render` is still invoked once per mount, so `ref` + `requestRender()` remains the
  paint path.
- Pointer input has two sources feeding one sink: native JSX handlers on the overlay and a
  raw SGR parser on `renderer.stdin` (the host's `processSingleMouseEvent` still consumes
  mouse input before plugins see it). The first native event that resolves to a real rail
  row retires the SGR parser; `debug().pointerSource` reports which won.
- Jumps prefer the host's `scrollChildIntoView(id, { align: "start" })` and wait on the
  scrollbox's `afterLayout` (bounded at 48 ms) instead of guessing frame counts.
