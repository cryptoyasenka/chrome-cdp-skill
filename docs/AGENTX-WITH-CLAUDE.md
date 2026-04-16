# Using AgentX + Claude Code

This guide walks you through connecting [AgentX antidetect browser](https://agentx.app/) profiles to [Claude Code](https://claude.com/claude-code) using this skill, so Claude can read and interact with tabs inside specific AgentX profiles (multi-account crypto, social media, web-scraping flows, etc.).

**This is fork-only functionality.** The upstream `pasky/chrome-cdp-skill` does not ship the AgentX resolver — if you want this, install from `cryptoyasenka/chrome-cdp-skill` as described below.

## What this actually does

- **AgentX** keeps each profile in its own folder at `%APPDATA%\AgentX\profile\<browser_id>\` and writes a `DevToolsActivePort` file there when the profile is running. That folder is not in the standard places `cdp.mjs` auto-detects.
- **`scripts/agentx.mjs`** reads `%APPDATA%\AgentX\data.db` (a SQLite database maintained by AgentX) to map a human-friendly selector (`1`, `"Profile 2"`) to the correct `browser_id`, then runs `cdp.mjs` with `CDP_PORT_FILE` pointed at that profile's port file.
- Claude Code discovers the skill via `~/.claude/skills/chrome-cdp/SKILL.md` and picks up the AgentX section when your prompt mentions AgentX, a profile number, or "antidetect".

Net result: you say "what's open in AgentX profile 2?" and Claude lists the tabs in that specific profile. No separate browser instance spun up. No re-login. Cookies, sessions, and logged-in state stay exactly as you left them.

## Prerequisites

- **Windows** (AgentX is Windows-only, so the resolver is too).
- **AgentX** installed, with at least one profile created and launched at least once (so `data.db` has the profile row and the profile folder exists).
- **Node.js 22.5 or newer** — the resolver uses the built-in `node:sqlite` module. Check with `node --version`.
- **Claude Code** installed ([claude.com/claude-code](https://claude.com/claude-code)).
- **Git** installed (for cloning the repo).

## Install

Pick whichever shell you use:

### cmd.exe

```cmd
git clone https://github.com/cryptoyasenka/chrome-cdp-skill C:\chrome-cdp-skill
mklink /J %USERPROFILE%\.claude\skills\chrome-cdp C:\chrome-cdp-skill\skills\chrome-cdp
```

### PowerShell

```powershell
git clone https://github.com/cryptoyasenka/chrome-cdp-skill C:\chrome-cdp-skill
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\chrome-cdp" -Target "C:\chrome-cdp-skill\skills\chrome-cdp"
```

**Why a junction (`mklink /J` / `New-Item -ItemType Junction`)?** Because updating the skill is then just `git pull` in `C:\chrome-cdp-skill` — all your Claude sessions see the new version immediately. No second copy to keep in sync.

Junctions **do not require admin** on Windows 10/11.

Verify the install:

```bash
node ~/.claude/skills/chrome-cdp/scripts/agentx.mjs list
```

You should see a table of your AgentX profiles with their running/not-running state.

## Start a profile

`agentx.mjs` cannot launch a profile — AgentX has no CLI, only GUI. So:

1. Open AgentX.
2. Click "Launch" on the profile you want Claude to connect to.
3. Wait for the browser window to appear.

Once it's running, the profile's folder contains a fresh `DevToolsActivePort` file and the resolver can find it.

## Using it from Claude Code

Claude discovers the skill automatically. You don't type a slash command — you just describe what you want in natural language, and Claude chooses the right command.

### Trigger phrases Claude picks up

- "AgentX profile 2"
- "профиль 2 в AgentX"
- "my antidetect browser"
- "the tabs in profile 3"

When Claude sees any of these, it uses `agentx.mjs`. For regular Chrome / Edge / etc. it uses plain `cdp.mjs`.

### Example prompts

**List what's open in a profile:**

> What tabs are open in AgentX profile 1?

Claude runs `agentx cdp 1 list` and reports back.

**Read a specific page:**

> In AgentX profile 2, open https://etherscan.io/address/0x... and tell me the token balance.

Claude runs `agentx cdp 2 nav <target> <url>`, waits for load, then `html` or `snap` to extract.

**Click something:**

> In profile 3, go to opensea.io and click the Connect Wallet button.

Claude combines `nav` + `click` on that profile.

**Upload a file to a form (new in this fork):**

> In profile 1, upload `C:/Users/me/model.onnx` to the file input on the current tab.

Claude uses `agentx cdp 1 upload <target> <selector> <file>` — no native file picker dialog opens.

### Multi-profile workflows

Because each `agentx cdp <id>` call targets a specific profile, you can ask Claude to do the same task across several profiles:

> For each of AgentX profiles 1 through 4, list the tabs and screenshot the active one.

Claude will iterate, and each screenshot stays isolated to its own profile — no cookie cross-contamination.

## Direct CLI use

If you prefer to drive it yourself instead of going through Claude:

```bash
# List all profiles and their running state
node ~/.claude/skills/chrome-cdp/scripts/agentx.mjs list

# List tabs inside a profile
node ~/.claude/skills/chrome-cdp/scripts/agentx.mjs cdp 1 list

# Screenshot a specific tab in a profile
node ~/.claude/skills/chrome-cdp/scripts/agentx.mjs cdp 1 shot <target-prefix>

# Navigate and evaluate JS
node ~/.claude/skills/chrome-cdp/scripts/agentx.mjs cdp "Profile 2" nav <target> https://example.com
node ~/.claude/skills/chrome-cdp/scripts/agentx.mjs cdp "Profile 2" eval <target> "document.title"

# Print just the port file path (for scripting)
node ~/.claude/skills/chrome-cdp/scripts/agentx.mjs path 1

# Or export CDP_PORT_FILE and use cdp.mjs directly
eval "$(node ~/.claude/skills/chrome-cdp/scripts/agentx.mjs env 1)"
node ~/.claude/skills/chrome-cdp/scripts/cdp.mjs list
```

`<target-prefix>` is the unique prefix shown by `list` (typically 8 hex characters, e.g. `6BE827FA`).

## Troubleshooting

### "AgentX database not found at ...data.db"

AgentX hasn't been launched yet on this machine. Open AgentX at least once so it creates its data directory.

### "profile #N is not running"

The profile's `DevToolsActivePort` file is missing — meaning the profile isn't currently open. Launch it in AgentX first.

### `agentx list` shows a profile as running but `agentx cdp <id> list` hangs

The profile crashed without cleaning up its port file, or the port it points to is no longer open. Close the profile fully in AgentX and relaunch it.

### "No profile matching ..."

The selector didn't match any profile. Run `agentx list` to see exact names. Selectors can be:
- Profile id (integer)
- Exact profile name
- Substring of the name (must be unambiguous)

### Claude doesn't trigger the skill

- Check that the junction exists: `ls ~/.claude/skills/chrome-cdp/` should show `SKILL.md` and `scripts/`.
- Try being explicit: say "use the chrome-cdp skill to list tabs in AgentX profile 1".
- Restart Claude Code if you just installed the skill mid-session.

### Node version error

`agentx.mjs` uses `node:sqlite` which requires Node 22.5+. If `node --version` shows older, install a newer Node from [nodejs.org](https://nodejs.org/) or via `nvm-windows`.

## Known limitations

- **No auto-start.** AgentX has no CLI, so profiles must be launched by hand through its GUI. `agentx.mjs` only resolves and connects.
- **Windows only** (the resolver). The core `cdp.mjs` works on macOS and Linux for standard Chrome / Brave / Edge / Chromium / Vivaldi — but AgentX itself is Windows-only, so this guide is too.
- **First-tab "Allow debugging?" prompt.** When Claude touches a tab for the first time after a profile launch, AgentX's Chromium surfaces the standard "Allow remote debugging" dialog. Click Allow once; subsequent commands reuse the daemon silently for 20 minutes of inactivity.
- **Playwright MCP coexistence.** If you also have Playwright MCP running against the same browser, they don't conflict — CDP allows multiple WebSocket clients. They just won't see each other's state.

## How it compares to alternatives

| Approach | Re-login per session | AgentX profile isolation | Admin required | Works for multi-account |
| --- | :-: | :-: | :-: | :-: |
| `chrome-cdp-skill` + `agentx.mjs` (this fork) | no | yes | no | yes |
| Playwright / Puppeteer launching a fresh browser | yes | no | no | no |
| chrome-devtools-mcp + stock Chrome | no | no (shared profile) | no | no |
| Dedicated antidetect-API subscription | varies | yes | no | yes (paid) |

The tradeoff: this fork only resolves and connects — it doesn't automate profile creation, proxy rotation, or fingerprint management. Those are AgentX's job. This is a thin bridge, not a replacement.

## Upstream

This fork's non-AgentX functionality comes entirely from [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill). The `upload` command and the AgentX resolver are the only additions here. Credit and design for the rest go to Petr Baudis.
