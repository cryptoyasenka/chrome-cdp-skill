# Changelog

All notable changes to this fork are documented here. For upstream history,
see [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this fork uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with a `-fork` suffix to distinguish from upstream releases.

## [1.0.0-fork] — 2026-04-16

First tagged release of the fork. Baseline: upstream commit `1fd55c7`.

### Added

- **AgentX profile resolver** (`scripts/agentx.mjs`) — maps AgentX profiles
  by id or name to their CDP endpoint. Reads `%APPDATA%\AgentX\data.db`
  via the built-in `node:sqlite` module. Subcommands: `list`, `path`,
  `env`, `cdp`, `doctor`.
- **`doctor` subcommand** — 10-check self-diagnostic: Node version,
  platform, `%APPDATA%`, AgentX install, `data.db`, profiles directory,
  profile count, running state, sibling `cdp.mjs`, Claude skill
  junction. Outputs `[OK]` / `[WARN]` / `[INFO]` / `[FAIL]` levels with
  actionable messages and exits non-zero if any `[FAIL]` is reported.
- **`upload` command** in `scripts/cdp.mjs` — attach a local file to
  `<input type="file">` via `DOM.setFileInputFiles`, bypassing the
  native OS file picker dialog.
- **`docs/AGENTX-WITH-CLAUDE.md`** — end-to-end guide for connecting
  AgentX profiles to Claude Code, including multilingual trigger phrase
  examples (English / Russian / Ukrainian / Polish / any other).
- **`package.json`** with `engines.node >= 22.5.0`, fork authorship
  (`@pasky` as upstream, `@cryptoyasenka` as fork maintainer), and
  fork-specific `repository` / `homepage` / `bugs` URLs.
- **GitHub Actions CI** — smoke tests on Ubuntu + Windows across Node
  22.5 / 22.x / 24.x matrix: syntax check, `--help` exit status,
  `doctor` error-path verification.

### Changed

- **Node.js 22.5+ is now a hard requirement.** The resolver uses
  `node:sqlite` (stable since 22.5); upstream `cdp.mjs` already
  required Node 22+ for the global `WebSocket`. The floor is enforced
  via `engines` in `package.json`, a runtime check in `doctor`, and
  prominent notes in README / SKILL.md / docs.
- **README.md** — adds a "What this fork adds" section, cmd.exe and
  PowerShell install snippets, browser compatibility table, and a
  doctor verify step.
- **SKILL.md** — Claude-facing skill instructions now include an
  AgentX section and explicitly tell the model to match on intent in
  any human language.

### Notes

- The Node "SQLite is experimental" warning is suppressed by
  intercepting `process.emit` before the default warning printer
  runs. `process.on('warning')` listeners fire *in addition to* the
  default printer, so that approach would not silence the message.

[1.0.0-fork]: https://github.com/cryptoyasenka/chrome-cdp-skill/releases/tag/v1.0.0-fork
