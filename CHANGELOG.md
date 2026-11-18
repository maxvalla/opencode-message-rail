# Changelog

All notable changes to this project. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning is
[SemVer](https://semver.org/).

## [0.2.0] — 2026-11-18

Targets OpenCode 2.3.2 (was 2.0.27) and OpenTUI ≥ 0.8.4 (was 0.5.17). The TUI plugin API is
unchanged across that range — `context`, `index`, `plugin` and `solid` type definitions are
byte-identical, and the host still publishes the same ten slot paths — so nothing had to be
migrated architecturally.

### Fixed

- The hover card now anchors to the rail row the tick was actually painted on. It previously
  derived that row as `i0 + k`, which only holds in the sliding-window layout: with 5 turns on
  a 41-row rail the first tick sits on row 16 while the card was drawn on row 1.
- The card follows its tick through scrolls and window slides instead of closing on the first
  scroll event. It closes only when that turn leaves the window or is no longer painted.
- Wheel-over-rail no longer dismisses an open card, matching the JSX path.

### Changed

- One pointer sink for both sources (native JSX handlers and the raw SGR parser), with a single
  `downRow`, so a click delivered by both cannot jump twice. The first native event that
  resolves a real rail row retires the SGR parser; `debug().pointerSource` reports which won.
- Jumps prefer the host's `scrollChildIntoView(id, { align: "start" })` and wait on the
  scrollbox's `afterLayout` (bounded at 48 ms) instead of guessing frame counts; the retry
  ladder shrank from 3 attempts to 2.
- `@opentui/solid` and `solid-js` are runtime dependencies, so an install always resolves what
  the built plugin imports. `prepare` builds `dist/`, so Git-spec installs work too.
- Relative imports carry `.js` extensions; the built output loads under Node as well as Bun.

### Added

- `src/controller.test.ts`: the real controller against a fake host — card anchor, follow/close
  rules, click de-duplication, the alignment rung, the native→SGR latch, cross-source wheel
  coalescing.
- CI on Linux and macOS; `CHANGELOG`, `CONTRIBUTING`, `SECURITY`, issue template.

## [0.1.0] — 2026-10

Initial implementation: per-turn ticks, chevrons, dwell-hover preview card, click-to-jump,
capability tiers 0–3, the four-rung jump ladder, a durable `Alt+R` toggle, and a debug channel.

[0.2.0]: https://github.com/maxvalla/opencode-message-rail/releases/tag/v0.2.0
[0.1.0]: https://github.com/maxvalla/opencode-message-rail/releases/tag/v0.1.0
