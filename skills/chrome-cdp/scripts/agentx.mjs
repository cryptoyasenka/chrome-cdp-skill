#!/usr/bin/env node
// AgentX profile resolver for chrome-cdp.
//
// Maps an AgentX profile (by id or name) to its DevToolsActivePort file,
// then either prints the path, prints a CDP_PORT_FILE export line, or execs
// `cdp.mjs` with CDP_PORT_FILE pre-set.
//
// Requires Node 22.5+. The resolver uses the built-in `node:sqlite` module,
// which was added in 22.5.0 behind `--experimental-sqlite`. The flag was
// removed in Node 23+ (so 23.x and 24.x don't need it), but the Node 22 LTS
// line kept the flag requirement. To spare users from thinking about this,
// the script re-launches itself with `--experimental-sqlite` when running
// on Node 22.x where the flag is missing. On Node 23+ the flag is a no-op
// (still accepted, just unnecessary). Upstream `cdp.mjs` only needs Node
// 22+ for the global `WebSocket`, which every 22.5+ install satisfies.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Node 22.x requires --experimental-sqlite for node:sqlite; re-exec with the
// flag if we're on 22.x and it's missing. Must happen before importing
// node:sqlite below, otherwise the import throws ERR_UNKNOWN_BUILTIN_MODULE.
{
  const [nodeMajor] = process.versions.node.split('.').map(Number);
  const needsFlag = nodeMajor === 22;
  const hasFlag = process.execArgv.some(a => a.startsWith('--experimental-sqlite'));
  if (needsFlag && !hasFlag) {
    const r = spawnSync(
      process.execPath,
      ['--experimental-sqlite', process.argv[1], ...process.argv.slice(2)],
      { stdio: 'inherit', env: process.env },
    );
    process.exit(r.status ?? 1);
  }
}

// Suppress the Node "SQLite is experimental" warning by intercepting the
// emit before the default warning printer runs. `process.on('warning')`
// listeners run in addition to the default handler, so they can't silence it.
const origEmit = process.emit.bind(process);
process.emit = function (name, data, ...rest) {
  if (
    name === 'warning' &&
    data &&
    data.name === 'ExperimentalWarning' &&
    /SQLite/i.test(data.message || '')
  ) {
    return false;
  }
  return origEmit(name, data, ...rest);
};

const { DatabaseSync } = await import('node:sqlite');

const APPDATA = process.env.APPDATA;
if (!APPDATA) {
  console.error('agentx: $APPDATA not set (this tool targets AgentX on Windows).');
  process.exit(2);
}

const AGENTX_ROOT = path.join(APPDATA, 'AgentX');
const DB_PATH = path.join(AGENTX_ROOT, 'data.db');
const PROFILES_DIR = path.join(AGENTX_ROOT, 'profile');

function openDb() {
  if (!existsSync(DB_PATH)) {
    console.error(`agentx: AgentX database not found at ${DB_PATH}`);
    process.exit(2);
  }
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

function listProfiles() {
  const db = openDb();
  const rows = db.prepare('SELECT id, name, browser_id FROM profile ORDER BY id').all();
  return rows.map(r => {
    const portFile = path.join(PROFILES_DIR, r.browser_id, 'DevToolsActivePort');
    const hasPortFile = existsSync(portFile);
    let port = null;
    let ageSec = null;
    if (hasPortFile) {
      try {
        const raw = readFileSync(portFile, 'utf8').split('\n')[0].trim();
        port = Number(raw) || null;
        const st = statSync(portFile);
        ageSec = Math.round((Date.now() - st.mtimeMs) / 1000);
      } catch {}
    }
    return { ...r, portFile, hasPortFile, port, ageSec };
  });
}

function resolveProfile(selector) {
  const db = openDb();
  const asInt = Number.parseInt(selector, 10);
  let row;
  if (!Number.isNaN(asInt) && String(asInt) === String(selector)) {
    row = db.prepare('SELECT id, name, browser_id FROM profile WHERE id = ?').get(asInt);
  }
  if (!row) {
    row = db.prepare('SELECT id, name, browser_id FROM profile WHERE name = ?').get(selector);
  }
  if (!row) {
    const matches = db.prepare('SELECT id, name, browser_id FROM profile WHERE name LIKE ?').all(`%${selector}%`);
    if (matches.length === 1) row = matches[0];
    else if (matches.length > 1) {
      console.error(`agentx: ambiguous selector "${selector}" — matches:`);
      for (const m of matches) console.error(`  #${m.id}  ${m.name}`);
      process.exit(2);
    }
  }
  if (!row) {
    console.error(`agentx: no profile matching "${selector}". Run 'agentx list' to see profiles.`);
    process.exit(2);
  }
  const portFile = path.join(PROFILES_DIR, row.browser_id, 'DevToolsActivePort');
  return { ...row, portFile };
}

function cmdList() {
  const profiles = listProfiles();
  if (!profiles.length) {
    console.log('(no profiles)');
    return;
  }
  const rows = profiles.map(p => {
    const state = p.hasPortFile ? `port=${p.port ?? '?'} (age ${p.ageSec}s)` : 'not running';
    return `  #${String(p.id).padStart(2)}  ${p.name.padEnd(20)}  ${state}`;
  });
  console.log('AgentX profiles:');
  console.log(rows.join('\n'));
}

function cmdPath(selector) {
  const p = resolveProfile(selector);
  if (!existsSync(p.portFile)) {
    console.error(`agentx: profile #${p.id} "${p.name}" is not running (no ${p.portFile}). Start it in AgentX first.`);
    process.exit(3);
  }
  process.stdout.write(p.portFile + '\n');
}

function cmdEnv(selector) {
  const p = resolveProfile(selector);
  if (!existsSync(p.portFile)) {
    console.error(`agentx: profile #${p.id} "${p.name}" is not running. Start it in AgentX first.`);
    process.exit(3);
  }
  const shell = (process.env.SHELL || '').toLowerCase();
  const isPwsh = !!process.env.PSModulePath && !shell.includes('bash') && !shell.includes('zsh');
  if (isPwsh) {
    console.log(`$env:CDP_PORT_FILE = "${p.portFile}"`);
  } else {
    console.log(`export CDP_PORT_FILE="${p.portFile}"`);
  }
}

function cmdCdp(selector, rest) {
  const p = resolveProfile(selector);
  if (!existsSync(p.portFile)) {
    console.error(`agentx: profile #${p.id} "${p.name}" is not running. Start it in AgentX first.`);
    process.exit(3);
  }
  const cdpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cdp.mjs');
  const r = spawnSync(process.execPath, [cdpPath, ...rest], {
    stdio: 'inherit',
    env: { ...process.env, CDP_PORT_FILE: p.portFile },
  });
  process.exit(r.status ?? 1);
}

function cmdDoctor() {
  const report = [];
  let issues = 0;

  const push = (level, msg) => {
    report.push(`  [${level.padEnd(4)}] ${msg}`);
    if (level === 'FAIL') issues++;
  };

  // Node version
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 5);
  if (nodeOk) {
    push('OK', `Node.js ${process.versions.node} (>= 22.5 required; flag for node:sqlite auto-added on Node 22.x)`);
  } else {
    push('FAIL', `Node.js ${process.versions.node} is too old — install Node 22.5+ from https://nodejs.org. Any LTS or Current release from the 22.5+ era works; on Node 22 this script auto-passes --experimental-sqlite so you don't need to.`);
  }

  // Platform
  if (process.platform === 'win32') {
    push('OK', 'Platform: win32');
  } else {
    push('FAIL', `Platform "${process.platform}" — AgentX is Windows-only`);
  }

  // APPDATA
  if (process.env.APPDATA) {
    push('OK', `APPDATA = ${process.env.APPDATA}`);
  } else {
    push('FAIL', 'APPDATA env var is not set');
  }

  // AgentX root
  if (existsSync(AGENTX_ROOT)) {
    push('OK', `AgentX directory: ${AGENTX_ROOT}`);
  } else {
    push('FAIL', `AgentX directory not found at ${AGENTX_ROOT} — install AgentX and launch it once`);
  }

  // data.db
  if (existsSync(DB_PATH)) {
    push('OK', 'AgentX database present (data.db)');
  } else {
    push('FAIL', `data.db not found at ${DB_PATH} — launch AgentX once to create it`);
  }

  // Profiles dir
  if (existsSync(PROFILES_DIR)) {
    push('OK', 'Profiles directory present');
  } else {
    push('WARN', `No profiles directory at ${PROFILES_DIR} — create a profile in the AgentX GUI`);
  }

  // Profiles count + running state
  if (nodeOk && existsSync(DB_PATH)) {
    try {
      const profiles = listProfiles();
      if (profiles.length === 0) {
        push('WARN', 'No profiles registered in AgentX yet');
      } else {
        push('OK', `${profiles.length} profile(s) registered`);
        const running = profiles.filter(p => p.hasPortFile).length;
        if (running > 0) {
          push('OK', `${running} profile(s) currently running`);
        } else {
          push('INFO', "No profiles currently running — launch one in AgentX before using 'agentx cdp'");
        }
      }
    } catch (e) {
      push('FAIL', `Could not read AgentX database: ${e.message}`);
    }
  }

  // Sibling cdp.mjs
  const cdpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cdp.mjs');
  if (existsSync(cdpPath)) {
    push('OK', 'Sibling cdp.mjs found');
  } else {
    push('FAIL', `cdp.mjs not found next to agentx.mjs at ${cdpPath}`);
  }

  // Claude skill junction (optional)
  const userHome = process.env.USERPROFILE;
  if (userHome) {
    const skillPath = path.join(userHome, '.claude', 'skills', 'chrome-cdp');
    if (existsSync(skillPath)) {
      push('OK', `Claude skill path: ${skillPath}`);
    } else {
      push('INFO', `No Claude skill junction at ${skillPath} (direct CLI use still works)`);
    }
  }

  console.log('agentx doctor:');
  console.log(report.join('\n'));
  console.log('');
  if (issues === 0) {
    console.log('All checks passed.');
  } else {
    console.log(`${issues} issue(s) found — see [FAIL] lines above.`);
    process.exit(1);
  }
}

function usage() {
  console.log(`agentx — AgentX profile resolver for chrome-cdp

Usage:
  agentx list                       List AgentX profiles and their running state
  agentx doctor                     Self-diagnostic (Node, AgentX, skill path)
  agentx path    <id|name>          Print DevToolsActivePort path for profile
  agentx env     <id|name>          Print shell line to export CDP_PORT_FILE
  agentx cdp     <id|name> <args>   Run cdp.mjs against the profile

Examples:
  agentx doctor                     # verify install, first thing to run
  agentx list
  agentx cdp 1 list                 # list tabs in AgentX profile #1
  agentx cdp "Profile 2" shot <tgt>
  eval "$(agentx env 1)" && cdp.mjs list
`);
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case 'list':   cmdList(); break;
  case 'doctor': cmdDoctor(); break;
  case 'path':   cmdPath(rest[0]); break;
  case 'env':    cmdEnv(rest[0]); break;
  case 'cdp':    cmdCdp(rest[0], rest.slice(1)); break;
  case undefined:
  case '-h':
  case '--help':
    usage(); break;
  default:
    console.error(`agentx: unknown command "${cmd}"`);
    usage();
    process.exit(2);
}
