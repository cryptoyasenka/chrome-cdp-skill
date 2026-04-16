# chrome-cdp

[![CI](https://github.com/cryptoyasenka/chrome-cdp-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/cryptoyasenka/chrome-cdp-skill/actions/workflows/ci.yml)
[![Node ≥ 22.12](https://img.shields.io/badge/node-%E2%89%A5%2022.12-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Let your AI agent see and interact with your **live Chrome session** — the tabs you already have open, your logged-in accounts, your current page state. No browser automation framework, no separate browser instance, no re-login.

Works out of the box with any Chrome installation. One toggle to enable, nothing else to install.

## What this fork adds

This is a fork of [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill) maintained by **[@cryptoyasenka](https://github.com/cryptoyasenka)**, with two additions on top of the upstream CLI:

- **AgentX antidetect browser support** — `scripts/agentx.mjs` (new in this fork) resolves an AgentX profile (by id or name) to its CDP endpoint, so Claude Code can read and drive specific profiles in multi-account workflows. Full walkthrough: **[docs/AGENTX-WITH-CLAUDE.md](docs/AGENTX-WITH-CLAUDE.md)**.
- **`upload` command** (new in this fork) — attach a local file to an `<input type="file">` via `DOM.setFileInputFiles`, without opening the native picker dialog.

Everything else — the daemon architecture, the `list`/`shot`/`snap`/`eval`/`nav`/`click`/`type`/`loadall` commands, the auto-detect logic — is upstream work by [Petr Baudis (@pasky)](https://github.com/pasky) and used here under the original MIT license.

### Quick install as a Claude Code skill (Windows)

> **Requires Node.js 22.12 or newer (LTS).** The fork uses the built-in `node:sqlite` module for the AgentX resolver and global `WebSocket` (stable since Node 22) for the CDP client. `node:sqlite` needs `--experimental-sqlite` on Node 22.5–22.8 and drops the flag in 22.9+; we pin the floor at 22.12 because that's the first Node 22 LTS with no-flag `node:sqlite` — the safe, zero-configuration install target. Check with `node --version`; upgrade from [nodejs.org](https://nodejs.org/) or via `nvm-windows` if older. No npm install.

cmd.exe:

```cmd
git clone https://github.com/cryptoyasenka/chrome-cdp-skill C:\chrome-cdp-skill
mklink /J %USERPROFILE%\.claude\skills\chrome-cdp C:\chrome-cdp-skill\skills\chrome-cdp
```

PowerShell:

```powershell
git clone https://github.com/cryptoyasenka/chrome-cdp-skill C:\chrome-cdp-skill
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\chrome-cdp" -Target "C:\chrome-cdp-skill\skills\chrome-cdp"
```

Junctions do not require admin. After install, `git pull` in `C:\chrome-cdp-skill` is picked up by every Claude Code session immediately.

Verify the install with the built-in self-diagnostic:

```bash
node ~/.claude/skills/chrome-cdp/scripts/agentx.mjs doctor
```

It checks your Node version, AgentX install, profile state, and the Claude skill junction — and tells you exactly what's wrong if something fails.

### Which browsers work?

| Browser | How it connects | Notes |
| --- | --- | --- |
| Chrome / Chromium / Brave / Edge / Vivaldi | auto-detect via standard install paths | toggle `chrome://inspect/#remote-debugging` once |
| **AgentX** (antidetect, Windows-only) | `scripts/agentx.mjs` | **fork-only**; see [docs/AGENTX-WITH-CLAUDE.md](docs/AGENTX-WITH-CLAUDE.md) |
| Any other Chromium-based browser (Dolphin, GoLogin, Multilogin, etc.) | set `CDP_PORT_FILE` to the full `DevToolsActivePort` path | no auto-detect |
| Firefox / Safari | not supported | different debug protocols |

The skill **connects to browsers that are already running** with remote debugging enabled. It never launches a browser itself — for AgentX specifically, you start the profile in the AgentX GUI first.

## Why this matters

Most browser automation tools launch a fresh, isolated browser. This one connects to the Chrome you're already running, so your agent can:

- Read pages you're logged into (Gmail, GitHub, internal tools, ...)
- Interact with tabs you're actively working in
- See the actual state of a page mid-workflow, not a clean reload

## Installation

### As a pi skill

```bash
pi install git:github.com/pasky/chrome-cdp-skill@v1.0.1
```

### For other agents (Amp, Claude Code, Cursor, etc.)

Clone or copy the `skills/chrome-cdp/` directory wherever your agent loads skills or context from. The only runtime dependency is **Node.js 22.12+ (LTS)** — no npm install needed. (22.12+ is required by the AgentX resolver shipped in this fork, which uses no-flag `node:sqlite`; if you will only ever use plain `cdp.mjs` against stock Chrome, Node 22+ is enough.)

### Enable remote debugging in Chrome

Navigate to `chrome://inspect/#remote-debugging` and toggle the switch. That's it.

The CLI auto-detects Chrome, Chromium, Brave, Edge, and Vivaldi on macOS, Linux, and Windows. If your browser stores `DevToolsActivePort` in a non-standard location, set the `CDP_PORT_FILE` environment variable to the full path.

## Usage

```bash
scripts/cdp.mjs list                              # list open tabs
scripts/cdp.mjs shot   <target>                   # screenshot → runtime dir
scripts/cdp.mjs snap   <target>                   # accessibility tree (compact, semantic)
scripts/cdp.mjs html   <target> [".selector"]     # full HTML or scoped to CSS selector
scripts/cdp.mjs eval   <target> "expression"      # evaluate JS in page context
scripts/cdp.mjs nav    <target> https://...       # navigate and wait for load
scripts/cdp.mjs net    <target>                   # network resource timing
scripts/cdp.mjs click  <target> "selector"        # click element by CSS selector
scripts/cdp.mjs clickxy <target> <x> <y>          # click at CSS pixel coordinates
scripts/cdp.mjs type   <target> "text"            # type at focused element (works in cross-origin iframes)
scripts/cdp.mjs upload <target> "selector" <file> # attach a local file to <input type=file> (fork-only)
scripts/cdp.mjs loadall <target> "selector"       # click "load more" until gone
scripts/cdp.mjs evalraw <target> <method> [json]  # raw CDP command passthrough
scripts/cdp.mjs open   [url]                      # open new tab (triggers Allow prompt)
scripts/cdp.mjs stop   [target]                   # stop daemon(s)
```

`<target>` is a unique prefix of the targetId shown by `list`.

## Why not chrome-devtools-mcp?

[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) reconnects on every command, so Chrome's "Allow debugging" modal can re-appear repeatedly and target enumeration times out with many tabs open. `chrome-cdp` holds one persistent daemon per tab — the modal fires once, and it handles 100+ tabs reliably.

## How it works

Connects directly to Chrome's remote debugging WebSocket — no Puppeteer, no intermediary. On first access to a tab, a lightweight background daemon is spawned that holds the session open. Chrome's "Allow debugging" modal appears once per tab; subsequent commands reuse the daemon silently. Daemons auto-exit after 20 minutes of inactivity.

This approach is also why it handles 100+ open tabs reliably, where tools built on Puppeteer often time out during target enumeration.
