# Contributing

Thanks for looking. This is a small plugin with a deliberately defensive design; the rules
below are what keeps it from taking the TUI down with it.

## Setup

```bash
npm install        # runs `prepare` → builds dist/
npm run typecheck
npm test           # bun test --conditions=browser
npm run build
```

Bun is required for tests. The `--conditions=browser` flag is **not optional**: without it
solid-js resolves to its SSR build, `createMemo` never invalidates, and the controller tests
assert against a frozen view.

Load a local checkout into the TUI with a `file:` entry in your OpenCode config:

```json
{ "plugins": ["file:/abs/path/to/opencode-message-rail"] }
```

`opencode plugin add` accepts npm/Git specs only, and a bare absolute directory does not load
the TUI half — the `file:` form is the one that works.

## Module map

| File | Responsibility | Rules |
| --- | --- | --- |
| `src/geom.ts` | Pure geometry: nav, layout, rail rows, CJK width | No host access, no timers, no I/O. Everything here is unit-tested |
| `src/probe.ts` | Find the transcript scrollbox, measure it | Structural checks only — never `instanceof` (the plugin resolves its own `@opentui/core`) |
| `src/turns.ts` | Build the turn list from host cache + paginated history | Every export throw-free: a failed read yields `[]`/`null` |
| `src/theme.ts` | Defensive theme reads with fixed fallbacks | Never `undefined` in a render prop |
| `src/controller.ts` | State, tiers, dwell card, jump ladder, pointer sink | Host reads go through `guard()`; the only reactive computation is `view` |
| `src/tui.tsx` | Plugin entry: slots, paint loop, keymap, debug channel | One cleanup releases every resource |

## Invariants

1. **Never throw into the host.** A failing probe must degrade the rail, not the TUI.
2. **One geometry.** `buildRailRows()` produces the array that render, hit-test and the hover
   card all consume. Do not derive a row a second way — that is exactly the bug that put the
   preview card at the top of the rail in fit/T2 layouts.
3. **The card follows its tick.** It is derived inside the `view` memo from `cardIdx`, never
   stored, and closes when the turn leaves `[i0, i1)`.
4. **Turns are built by `rebuild()`, never read inside a tracked computation.**
5. **Pointer input goes through `controller.pointer`.** Both sources (native JSX handlers and
   the SGR parser) call it; `downRow` lives there so a click delivered twice cannot jump twice.
6. **No `instanceof` across the plugin/host boundary** — the host bundles a different
   `@opentui/core` copy.

## Tests

- `src/geom.test.ts` — pure functions, no host.
- `src/controller.test.ts` — the real `createRail` against a fake host (scrollbox, geometry,
  SGR emitter, `afterLayout`/`scrollChildIntoView` stubs). No terminal needed. If you add
  host-facing behaviour, this is where it gets pinned.

Both files must pass before a PR; CI runs them on Linux and macOS.

## Commits and PRs

- Keep commits focused; explain *why* in the body, not just what.
- Behaviour changes need a test in one of the two files above.
- If you touch the paint path or the pointer routing, say which `tier` and `pointerSource` you
  verified — those two fields are the whole diagnosis surface.
