# Security policy

## Supported versions

The latest published 0.x release receives fixes. Because the plugin runs inside the OpenCode
TUI process, security issues are judged by what they can do to that process, your terminal, or
your session data — not by the usual "server compromise" bar.

## Reporting

Please report privately via GitHub Security Advisories ("Report a vulnerability" on the
repository's Security tab) rather than a public issue. Include the OpenCode version, the OS,
and — if the report concerns the pointer path — `pointerSource` and `tier` from the debug
snapshot.

## What this plugin touches

- **Reads** the current session's message list (ids, timestamps, text) from the host's local
  cache and, for long sessions, the local server's message API. The text is displayed in the
  hover card; it is not sent anywhere.
- **Reads** `renderer.stdin` in parallel with the host to parse mouse SGR sequences, and
  detaches that listener as soon as native pointer events prove live. It does not write to
  stdin and does not swallow host input.
- **Writes** one file when `debugFile` is configured: a JSON snapshot containing message ids,
  geometry and the turn list. Message text is not included, but ids and timings are. An
  attacker who can read that path can learn your session structure — keep it out of shared
  directories.
- **Makes no network requests.** It does not read credentials, environment secrets or files
  other than the configured debug path.

## Threat notes

- The plugin deliberately never throws into the host; a malformed renderable tree degrades to
  "no rail". If you find an input that crashes the TUI instead, that is a security-relevant
  bug.
- The SGR fallback trusts only sequences starting with `ESC [ <`, parsed with a bounded
  buffer, and never dispatches host keybindings from pointer-derived input.
