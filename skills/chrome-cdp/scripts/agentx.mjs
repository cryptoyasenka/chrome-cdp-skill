#!/usr/bin/env node
// AgentX profile resolver for chrome-cdp.
//
// Maps an AgentX profile (by id or name) to its DevToolsActivePort file,
// then either prints the path, prints a CDP_PORT_FILE export line, or execs
// `cdp.mjs` with CDP_PORT_FILE pre-set.
//
// Requires Node 22.5+ (node:sqlite).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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

function usage() {
  console.log(`agentx — AgentX profile resolver for chrome-cdp

Usage:
  agentx list                       List AgentX profiles and their running state
  agentx path    <id|name>          Print DevToolsActivePort path for profile
  agentx env     <id|name>          Print shell line to export CDP_PORT_FILE
  agentx cdp     <id|name> <args>   Run cdp.mjs against the profile

Examples:
  agentx list
  agentx cdp 1 list                 # list tabs in AgentX profile #1
  agentx cdp "Profile 2" shot <tgt>
  eval "$(agentx env 1)" && cdp.mjs list
`);
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case 'list': cmdList(); break;
  case 'path': cmdPath(rest[0]); break;
  case 'env':  cmdEnv(rest[0]); break;
  case 'cdp':  cmdCdp(rest[0], rest.slice(1)); break;
  case undefined:
  case '-h':
  case '--help':
    usage(); break;
  default:
    console.error(`agentx: unknown command "${cmd}"`);
    usage();
    process.exit(2);
}
