---
name: chrome-cdp
description: Interact with local Chrome browser session (only on explicit user approval after being asked to inspect, debug, or interact with a page open in Chrome)
---

# Chrome CDP

Lightweight Chrome DevTools Protocol CLI. Connects directly via WebSocket — no Puppeteer, works with 100+ tabs, instant connection.

## Prerequisites

- Chrome (or Chromium, Brave, Edge, Vivaldi) with remote debugging enabled: open `chrome://inspect/#remote-debugging` and toggle the switch
- **Node.js 22.12+ (LTS)** — required. Uses built-in `WebSocket` (stable since 22) for CDP + built-in `node:sqlite` (flag-free since 22.9, first LTS in 22.12) for the AgentX resolver. Check with `node --version`; upgrade from https://nodejs.org if older.
- If your browser's `DevToolsActivePort` is in a non-standard location, set `CDP_PORT_FILE` to its full path

## Commands

All commands use `scripts/cdp.mjs`. The `<target>` is a **unique** targetId prefix from `list`; copy the full prefix shown in the `list` output (for example `6BE827FA`). The CLI rejects ambiguous prefixes.

### List open pages

```bash
scripts/cdp.mjs list
```

### Take a screenshot

```bash
scripts/cdp.mjs shot <target> [file]    # default: screenshot-<target>.png in runtime dir
```

Captures the **viewport only**. Scroll first with `eval` if you need content below the fold. Output includes the page's DPR and coordinate conversion hint (see **Coordinates** below).

### Accessibility tree snapshot

```bash
scripts/cdp.mjs snap <target>
```

### Evaluate JavaScript

```bash
scripts/cdp.mjs eval <target> <expr>
```

> **Watch out:** avoid index-based selection (`querySelectorAll(...)[i]`) across multiple `eval` calls when the DOM can change between them (e.g. after clicking Ignore, card indices shift). Collect all data in one `eval` or use stable selectors.

### Other commands

```bash
scripts/cdp.mjs html    <target> [selector]   # full page or element HTML
scripts/cdp.mjs nav     <target> <url>         # navigate and wait for load
scripts/cdp.mjs net     <target>               # resource timing entries
scripts/cdp.mjs click   <target> <selector>    # click element by CSS selector
scripts/cdp.mjs clickxy <target> <x> <y>       # click at CSS pixel coords
scripts/cdp.mjs type    <target> <text>         # Input.insertText at current focus; works in cross-origin iframes unlike eval
scripts/cdp.mjs upload  <target> <selector> <file>  # attach a local file to <input type="file"> (no picker)
scripts/cdp.mjs loadall <target> <selector> [ms]  # click "load more" until gone (default 1500ms between clicks)
scripts/cdp.mjs evalraw <target> <method> [json]  # raw CDP command passthrough
scripts/cdp.mjs open    [url]                  # open new tab (each triggers Allow prompt)
scripts/cdp.mjs stop    [target]               # stop daemon(s)
```

## Coordinates

`shot` saves an image at native resolution: image pixels = CSS pixels × DPR. CDP Input events (`clickxy` etc.) take **CSS pixels**.

```
CSS px = screenshot image px / DPR
```

`shot` prints the DPR for the current page. Typical Retina (DPR=2): divide screenshot coords by 2.

## Tips

- Prefer `snap --compact` over `html` for page structure.
- Use `type` (not eval) to enter text in cross-origin iframes — `click`/`clickxy` to focus first, then `type`.
- Chrome shows an "Allow debugging" modal once per tab on first access. A background daemon keeps the session alive so subsequent commands need no further approval. Daemons auto-exit after 20 minutes of inactivity.

## AgentX antidetect browser (Windows)

If the user mentions **AgentX** (brand name, identical in any language), or asks about a specific browser profile, an antidetect browser, or multi-account browsing **in any human language** — use the `agentx` helper to resolve a profile to its CDP endpoint automatically. Match on intent, not on exact wording. Recognized equivalents for "profile N" / "antidetect" include (non-exhaustive): "profile 2" / "профиль 2" / "профіль 2" / "profil 2" / "антидетект" / "антидетект браузер" / "antydetekt" — but accept any paraphrase in any language, including ones not listed here. This bypasses the need to find `DevToolsActivePort` manually.

```bash
scripts/agentx.mjs doctor                     # self-diagnostic: Node version, AgentX, paths
scripts/agentx.mjs list                       # list AgentX profiles, show which are running
scripts/agentx.mjs cdp <id|name> <cdp-args>   # run cdp.mjs against a profile
scripts/agentx.mjs path <id|name>             # just print the DevToolsActivePort path
scripts/agentx.mjs env  <id|name>             # print shell line to export CDP_PORT_FILE
```

When the user reports the skill isn't working ("не работает", "broken", "can't connect"), run `scripts/agentx.mjs doctor` first — it pinpoints Node version mismatches, missing AgentX install, or broken skill junction in one shot.

Examples:

```bash
scripts/agentx.mjs cdp 1 list                               # list tabs in Profile 1
scripts/agentx.mjs cdp "Profile 2" nav <tgt> https://...    # navigate a tab in Profile 2
scripts/agentx.mjs cdp 1 upload <tgt> "#model-file" model.onnx
```

The user must start the profile in the AgentX GUI first — there is no CLI to auto-start profiles.

For other non-standard browsers, set `CDP_PORT_FILE` to the full path of the `DevToolsActivePort` file; auto-detection only covers Chrome / Chromium / Brave / Edge / Vivaldi in their standard install locations.
