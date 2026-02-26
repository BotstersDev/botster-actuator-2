/**
 * Shell command executor — spawns child processes with PTY support and process registry integration
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { ExecPayload } from '../protocol.js';
import { processRegistry, type ProcessSession } from '../process-registry.js';

export interface ShellExecOptions {
  command: string;
  cwd?: string;
  timeout?: number; // seconds, default 1800 (30 min)
  env?: Record<string, string>;
  pty?: boolean;
  background?: boolean;
  yieldMs?: number;
}

export interface ShellExecCallbacks {
  onStdout: (data: string) => void;
  onStderr: (data: string) => void;
  onDone: (exitCode: number, durationMs: number, session?: ProcessSession) => void;
  onError: (error: string, session?: ProcessSession) => void;
  onYield?: (session: ProcessSession) => void;
}

const DEFAULT_TIMEOUT = 1800; // 30 minutes in seconds
const MAX_TIMEOUT = 3600; // 1 hour hard cap in seconds

export async function executeShell(opts: ShellExecOptions, callbacks: ShellExecCallbacks): Promise<ProcessSession> {
  const startTime = Date.now();
  const timeoutSeconds = Math.min(opts.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const timeoutMs = timeoutSeconds * 1000;
  
  let proc: ChildProcess | null = null;
  let ptyProcess: any = null;
  let killed = false;
  let usePty = opts.pty ?? false;

  // Create session in registry
  const session = processRegistry.addSession(opts.command, opts.cwd ?? process.cwd());

  // Try to import node-pty for PTY support
  let ptyModule: any = null;
  if (usePty) {
    try {
      ptyModule = await import('@lydell/node-pty').catch(() => null);
    } catch (err) {
      console.warn('[shell] node-pty not available, falling back to regular spawn');
      usePty = false;
    }
  }

  try {
    if (usePty && ptyModule) {
      // Use PTY
      ptyProcess = ptyModule.spawn('sh', ['-c', opts.command], {
        cwd: opts.cwd || process.cwd(),
        env: { ...process.env, ...opts.env },
      });
      
      session.pid = ptyProcess.pid;
      session.stdin = ptyProcess;
      
    } else {
      // Use regular spawn
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
          // SIGTERM first
          process.kill(session.pid, 'SIGTERM');
          
          // SIGKILL after 5s grace period
          setTimeout(() => {
            if (session.pid && !session.exited) {
              try {
                process.kill(session.pid, 'SIGKILL');
              } catch (err) {
                // Process might have already exited
              }
            }
          }, 5000);
        } catch (err) {
          // Process might have already exited
        }
      }
      processRegistry.markExited(session.id, 1, 'SIGTERM');
      callbacks.onError(`Command timed out after ${timeoutSeconds}s`, session);
    }
  }, timeoutMs);

  // Set up yield timer if specified
  let yieldTimer: NodeJS.Timeout | null = null;
  if (opts.yieldMs && callbacks.onYield) {
    yieldTimer = setTimeout(() => {
      if (!killed && !session.exited) {
        processRegistry.markBackgrounded(session.id);
        callbacks.onYield!(session);
      }
    }, opts.yieldMs);
  }

  if (usePty && ptyProcess) {
    // PTY event handlers
    ptyProcess.onData((data: string) => {
      processRegistry.appendOutput(session.id, data);
      callbacks.onStdout(data);
    });

    ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      clearTimeout(timer);
      if (yieldTimer) clearTimeout(yieldTimer);
      
      if (!killed) {
        processRegistry.markExited(session.id, exitCode, signal ? `SIG${signal}` : undefined);
        callbacks.onDone(exitCode ?? 1, Date.now() - startTime, session);
      }
    });

  } else if (proc) {
    // Regular spawn event handlers
    proc.stdout?.on('data', (chunk: Buffer) => {
      const data = chunk.toString();
      processRegistry.appendOutput(session.id, data);
      callbacks.onStdout(data);
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const data = chunk.toString();
      processRegistry.appendOutput(session.id, data);
      callbacks.onStderr(data);
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      if (yieldTimer) clearTimeout(yieldTimer);
      
      if (!killed) {
        processRegistry.markExited(session.id, code, signal || undefined);
        callbacks.onDone(code ?? 1, Date.now() - startTime, session);
      }
    });

    proc.on('error', (err) => {
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
