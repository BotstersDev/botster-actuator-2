// @ts-check
/**
 * Shell command executor — spawns child processes with PTY support and process registry integration
 */
import { spawn } from 'node:child_process';
import { processRegistry } from '../process-registry.js';

const DEFAULT_TIMEOUT = 1800; // 30 minutes in seconds
const MAX_TIMEOUT = 3600; // 1 hour hard cap in seconds

/**
 * @typedef {{ command: string, cwd?: string, timeout?: number, env?: Record<string, string>, pty?: boolean, background?: boolean, yieldMs?: number }} ShellExecOptions
 */

/**
 * @typedef {{ onStdout: (data: string) => void, onStderr: (data: string) => void, onDone: (exitCode: number, durationMs: number, session?: import('../process-registry.js').ProcessSession) => void, onError: (error: string, session?: import('../process-registry.js').ProcessSession) => void, onYield?: (session: import('../process-registry.js').ProcessSession) => void }} ShellExecCallbacks
 */

/**
 * Execute a shell command
 * @param {ShellExecOptions} opts
 * @param {ShellExecCallbacks} callbacks
 * @returns {Promise<import('../process-registry.js').ProcessSession>}
 */
export async function executeShell(opts, callbacks) {
  const startTime = Date.now();
  const timeoutSeconds = Math.min(opts.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const timeoutMs = timeoutSeconds * 1000;

  /** @type {import('node:child_process').ChildProcess | null} */
  let proc = null;
  /** @type {any} */
  let ptyProcess = null;
  let killed = false;
  let usePty = opts.pty ?? false;

  // Create session in registry
  const session = processRegistry.addSession(opts.command, opts.cwd ?? process.cwd());

  // Try to import node-pty for PTY support
  /** @type {any} */
  let ptyModule = null;
  if (usePty) {
    try {
      ptyModule = await import('@lydell/node-pty').catch(() => null);
    } catch (_err) {
      console.warn('[shell] node-pty not available, falling back to regular spawn');
      usePty = false;
    }
  }

  try {
    if (usePty && ptyModule) {
      ptyProcess = ptyModule.spawn('sh', ['-c', opts.command], {
        cwd: opts.cwd || process.cwd(),
        env: { ...process.env, ...opts.env },
      });

      session.pid = ptyProcess.pid;
      session.stdin = ptyProcess;
    } else {
      proc = spawn('sh', ['-c', opts.command], {
        cwd: opts.cwd || process.cwd(),
        env: { ...process.env, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      session.pid = proc.pid;
      session.stdin = proc.stdin ?? undefined;
    }
  } catch (err) {
    processRegistry.markExited(session.id, 1);
    callbacks.onError(`Failed to spawn: ${err}`, session);
    return session;
  }

  // Set up timeout
  const timer = setTimeout(() => {
    if (!killed) {
      killed = true;
      if (session.pid) {
        try {
          process.kill(session.pid, 'SIGTERM');

          setTimeout(() => {
            if (session.pid && !session.exited) {
              try {
                process.kill(session.pid, 'SIGKILL');
              } catch (_err) {
                // Process might have already exited
              }
            }
          }, 5000);
        } catch (_err) {
          // Process might have already exited
        }
      }
      processRegistry.markExited(session.id, 1, 'SIGTERM');
      callbacks.onError(`Command timed out after ${timeoutSeconds}s`, session);
    }
  }, timeoutMs);

  // Set up yield timer if specified
  /** @type {NodeJS.Timeout | null} */
  let yieldTimer = null;
  if (opts.yieldMs && callbacks.onYield) {
    yieldTimer = setTimeout(() => {
      if (!killed && !session.exited) {
        processRegistry.markBackgrounded(session.id);
        callbacks.onYield?.(session);
      }
    }, opts.yieldMs);
  }

  if (usePty && ptyProcess) {
    ptyProcess.onData((/** @type {string} */ data) => {
      processRegistry.appendOutput(session.id, data);
      callbacks.onStdout(data);
    });

    ptyProcess.onExit((/** @type {{ exitCode: number, signal?: number }} */ info) => {
      clearTimeout(timer);
      if (yieldTimer) clearTimeout(yieldTimer);

      if (!killed) {
        processRegistry.markExited(session.id, info.exitCode, info.signal ? `SIG${info.signal}` : undefined);
        callbacks.onDone(info.exitCode ?? 1, Date.now() - startTime, session);
      }
    });
  } else if (proc) {
    proc.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
      const data = chunk.toString();
      processRegistry.appendOutput(session.id, data);
      callbacks.onStdout(data);
    });

    proc.stderr?.on('data', (/** @type {Buffer} */ chunk) => {
      const data = chunk.toString();
      processRegistry.appendOutput(session.id, data);
      callbacks.onStderr(data);
    });

    proc.on('close', (/** @type {number | null} */ code, /** @type {string | null} */ signal) => {
      clearTimeout(timer);
      if (yieldTimer) clearTimeout(yieldTimer);

      if (!killed) {
        processRegistry.markExited(session.id, code, signal || undefined);
        callbacks.onDone(code ?? 1, Date.now() - startTime, session);
      }
    });

    proc.on('error', (/** @type {Error} */ err) => {
      clearTimeout(timer);
      if (yieldTimer) clearTimeout(yieldTimer);

      if (!killed) {
        processRegistry.markExited(session.id, 1);
        callbacks.onError(`Process error: ${err.message}`, session);
      }
    });
  }

  return session;
}
