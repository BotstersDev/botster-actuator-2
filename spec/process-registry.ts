/**
 * Process Registry — tracks active and backgrounded shell sessions
 * Maps session IDs to ProcessSession objects with output buffering
 */
import { type Writable } from 'node:stream';
import type { ProcessInfo } from './protocol.js';

export const MAX_OUTPUT_CHARS = 200_000;
export const TAIL_CHARS = 4000;

export interface ProcessSession {
  id: string;             // short slug (8 chars)
  command: string;
  pid?: number;
  startedAt: number;
  cwd: string;
  exited: boolean;
  exitCode?: number | null;
  exitSignal?: string | null;
  backgrounded: boolean;
  aggregated: string;     // full output (up to max)
  tail: string;           // last N chars for quick poll
  maxOutputChars: number;
  stdin?: Writable;       // for write/send-keys
}

class ProcessRegistry {
  private sessions = new Map<string, ProcessSession>();

  /** Add a new process session */
  addSession(command: string, cwd: string, pid?: number): ProcessSession {
    const id = this.createSessionSlug();
    const session: ProcessSession = {
      id,
      command,
      pid,
      startedAt: Date.now(),
      cwd,
      exited: false,
      backgrounded: false,
      aggregated: '',
      tail: '',
      maxOutputChars: MAX_OUTPUT_CHARS,
    };
    
    this.sessions.set(id, session);
    return session;
  }

  /** Get a session by ID */
  getSession(id: string): ProcessSession | undefined {
    return this.sessions.get(id);
  }

  /** List all sessions */
  listSessions(): ProcessSession[] {
    return Array.from(this.sessions.values());
  }

  /** Mark session as backgrounded */
  markBackgrounded(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.backgrounded = true;
      return true;
    }
    return false;
  }

  /** Mark session as exited */
  markExited(id: string, exitCode?: number | null, exitSignal?: string | null): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.exited = true;
      session.exitCode = exitCode;
      session.exitSignal = exitSignal;
      session.stdin = undefined; // Close stdin reference
      return true;
    }
    return false;
  }

  /** Append output to session (with truncation) */
  appendOutput(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    // Append to aggregated output with truncation
    const newOutput = session.aggregated + data;
    if (newOutput.length > session.maxOutputChars) {
      // Keep the last maxOutputChars characters
      session.aggregated = newOutput.slice(-session.maxOutputChars);
    } else {
      session.aggregated = newOutput;
    }

    // Update tail (last TAIL_CHARS characters)
    this.updateTail(session);
    return true;
  }

  /** Get tail output for quick polling */
  tail(id: string): string {
    const session = this.sessions.get(id);
    return session?.tail ?? '';
  }

  /** Kill a session */
  killSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session && session.pid) {
      try {
        // Try SIGTERM first
        process.kill(session.pid, 'SIGTERM');
        
        // Schedule SIGKILL after 5s grace period
        setTimeout(() => {
          if (session.pid && !session.exited) {
            try {
              process.kill(session.pid, 'SIGKILL');
            } catch (err) {
              // Process might have already exited
            }
          }
        }, 5000);
        
        return true;
      } catch (err) {
        // Process might have already exited
        return false;
      }
    }
    return false;
  }

  /** Create a short session slug (8 random chars) */
  createSessionSlug(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Ensure uniqueness (very unlikely collision, but check anyway)
    if (this.sessions.has(result)) {
      return this.createSessionSlug();
    }
    
    return result;
  }

  /** Update tail for a session */
  private updateTail(session: ProcessSession): void {
    if (session.aggregated.length <= TAIL_CHARS) {
      session.tail = session.aggregated;
    } else {
      session.tail = session.aggregated.slice(-TAIL_CHARS);
    }
  }

  /** Convert ProcessSession to ProcessInfo for protocol */
  toProcessInfo(session: ProcessSession): ProcessInfo {
    return {
      id: session.id,
      command: session.command,
      pid: session.pid,
      startedAt: session.startedAt,
      cwd: session.cwd,
      exited: session.exited,
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      backgrounded: session.backgrounded,
    };
  }
}

// Singleton instance
export const processRegistry = new ProcessRegistry();