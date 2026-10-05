/**
 * @file launchmind-dev.mjs
 * @description Managed Next.js development launcher.
 *
 * One build directory has one writer. The lock is acquired atomically before
 * Next.js starts, checked against a live managed PID, and removed only by the
 * process that owns it. A separate port check prevents Next.js from silently
 * selecting 3001 when 3000 is occupied.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeProductionBuildArtifacts } from './guard-dev-dist.mjs';

const REPO = process.cwd();
const RUNTIME_DIR = join(REPO, '.tmp');

export function pidIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function managedCommand(pid) {
  if (process.platform === 'win32') return null;
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function lockName(distDir) {
  const safe = distDir.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'next';
  return `launchmind-next-dev-${safe}.pid`;
}

export function lockPathFor(distDir, runtimeDir = RUNTIME_DIR) {
  return join(runtimeDir, lockName(distDir));
}

function readLock(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function isExpectedManagedOwner(lock) {
  if (!lock || lock.cwd !== REPO || !pidIsAlive(Number(lock.pid))) return false;
  const command = managedCommand(Number(lock.pid));
  // Windows has no portable `ps`; the repository path + live PID is the best
  // available verification there. Unix additionally rejects PID reuse.
  return command === null || command.includes('scripts/launchmind-dev.mjs');
}

export function acquireLock({ distDir, port, mode, runtimeDir = RUNTIME_DIR }) {
  mkdirSync(runtimeDir, { recursive: true });
  const path = lockPathFor(distDir, runtimeDir);
  const existing = existsSync(path) ? readLock(path) : null;
  if (existing && isExpectedManagedOwner(existing)) {
    const error = new Error(
      `LaunchMind frontend is already running on port ${existing.port}.\n` +
      `Starting another Next.js dev instance against the same ${existing.distDir} directory can corrupt ` +
      `the running dev environment.\n\nStop the existing server first or use npm run dev:isolated.`,
    );
    error.code = 'LM_DEV_ALREADY_RUNNING';
    throw error;
  }
  // Missing/malformed/dead/PID-reused locks are stale. Only the lock is
  // removed; no process is terminated and no build output is touched.
  if (existsSync(path)) {
    console.warn(
      `[launchmind-dev] Removed stale lock ${path}` +
      `${existing?.pid ? ` (PID ${existing.pid} is not a live managed LaunchMind launcher)` : ''}.`,
    );
    unlinkSync(path);
  }

  const record = { pid: process.pid, childPid: null, port, distDir, mode, cwd: REPO,
    startedAt: new Date().toISOString() };
  let fd;
  try {
    fd = openSync(path, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Another LaunchMind frontend startup acquired ${path}. Try again after it finishes.`);
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return { path, record };
}

export function releaseLock(lock) {
  if (!lock?.path || !existsSync(lock.path)) return;
  const current = readLock(lock.path);
  if (Number(current?.pid) === process.pid) unlinkSync(lock.path);
}

function portOwner(port) {
  if (process.platform === 'win32') return null;
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const line = result.stdout.trim().split('\n').slice(0, 2).join('\n');
  return line || null;
}

export function assertPortAvailable(port) {
  return new Promise((resolveProbe, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', error => {
      const owner = portOwner(port);
      reject(new Error(
        `Port ${port} is already occupied. LaunchMind will not silently switch ports.` +
        `${owner ? `\n\n${owner}` : ''}\n\nStop that process first, or use npm run dev:isolated.`,
        { cause: error },
      ));
    });
    probe.listen(port, '0.0.0.0', () => probe.close(resolveProbe));
  });
}

function parseArgs(argv) {
  const values = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(arg => {
    const [key, ...rest] = arg.slice(2).split('=');
    return [key, rest.join('=') || 'true'];
  }));
  const isolated = values.isolated === 'true';
  return {
    mode: values.mode === 'demo' ? 'demo' : 'real',
    port: Number(values.port ?? (isolated ? 3002 : 3000)),
    distDir: values['dist-dir'] ?? (isolated ? '.next-dev-3002' : '.next'),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid frontend port: ${config.port}`);
  }

  const lock = acquireLock(config);
  let child = null;
  try {
    await assertPortAvailable(config.port);
    removeProductionBuildArtifacts(resolve(REPO, config.distDir));

    const nextBin = join(REPO, 'node_modules', 'next', 'dist', 'bin', 'next');
    const env = {
      ...process.env,
      NEXT_DIST_DIR: config.distDir,
      ...(config.mode === 'demo' ? { MORNING_BRIEF_DEMO_DATA: 'true' }
        : { MORNING_BRIEF_DEMO_DATA: 'false' }),
    };
    console.log(
      `\nLaunchMind frontend\n` +
      `Mode: ${config.mode === 'demo' ? 'Morning Brief demo' : 'Real workspace'}\n` +
      `Port: ${config.port}\nBuild dir: ${config.distDir}\nPID: ${process.pid}\n`,
    );
    child = spawn(process.execPath, [nextBin, 'dev', '-p', String(config.port)], {
      cwd: REPO, env, stdio: 'inherit',
    });
    lock.record.childPid = child.pid ?? null;
    writeFileSync(lock.path, `${JSON.stringify(lock.record, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    releaseLock(lock);
    throw error;
  }

  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      if (child && !child.killed) child.kill(signal);
    });
  }
  process.on('exit', () => releaseLock(lock));
  child.on('error', error => {
    console.error(`[launchmind-dev] Could not start Next.js: ${error.message}`);
    releaseLock(lock);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    releaseLock(lock);
    if (signal) process.exitCode = signal === 'SIGINT' ? 130 : 143;
    else process.exitCode = code ?? 1;
  });
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch(error => {
    console.error(`\n[launchmind-dev] ${error.message}\n`);
    process.exitCode = 1;
  });
}
