/**
 * Process handler — manages process tool actions (list, poll, log, write, send-keys, kill)
 */
import { processRegistry } from '../process-registry.js';
import type { ProcessPayload, ProcessInfo } from '../protocol.js';

export interface ProcessActionResult {
  success: boolean;
  sessions?: ProcessInfo[];
  session?: ProcessInfo;
  tail?: string;
  output?: string;
  error?: string;
}

export class ProcessHandler {
  
  /**
   * Handle a process action
   */
  handle(payload: ProcessPayload): ProcessActionResult {
    switch (payload.action) {
      case 'list':
        return this.listSessions();
      
      case 'poll':
        return this.pollSession(payload.sessionId);
      
      case 'log':
        return this.getSessionLog(payload.sessionId, payload.offset, payload.limit);
      
      case 'write':
        return this.writeToSession(payload.sessionId, payload.data);
      
      case 'send-keys':
        return this.sendKeysToSession(payload.sessionId, payload.keys);
      
      case 'kill':
        return this.killSession(payload.sessionId);
      
      default:
        return { success: false, error: `Unknown process action: ${(payload as any).action}` };
    }
  }

  /**
   * List all sessions with summary
   */
  private listSessions(): ProcessActionResult {
    const sessions = processRegistry.listSessions();
    const sessionInfos = sessions.map(session => processRegistry.toProcessInfo(session));
    
    return {
      success: true,
      sessions: sessionInfos
    };
  }

  /**
   * Poll session status and return recent output (tail)
   */
  private pollSession(sessionId?: string): ProcessActionResult {
    if (!sessionId) {
      return { success: false, error: 'Session ID required for poll action' };
    }

    const session = processRegistry.getSession(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    return {
      success: true,
      session: processRegistry.toProcessInfo(session),
      tail: session.tail
    };
  }

  /**
   * Get session output with offset/limit support
   */
  private getSessionLog(sessionId?: string, offset?: number, limit?: number): ProcessActionResult {
    if (!sessionId) {
      return { success: false, error: 'Session ID required for log action' };
    }

    const session = processRegistry.getSession(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    let output = session.aggregated;
    
    // Apply offset and limit if specified
    if (offset !== undefined || limit !== undefined) {
      const lines = output.split('\n');
      const startLine = Math.max(0, (offset ?? 1) - 1); // Convert to 0-based
      const endLine = limit !== undefined ? startLine + limit : lines.length;
      
      output = lines.slice(startLine, endLine).join('\n');
    }

    return {
      success: true,
      session: processRegistry.toProcessInfo(session),
      output
    };
  }

  /**
   * Write data to session stdin
   */
  private writeToSession(sessionId?: string, data?: string): ProcessActionResult {
    if (!sessionId) {
      return { success: false, error: 'Session ID required for write action' };
    }

    if (data === undefined) {
      return { success: false, error: 'Data required for write action' };
    }

    const session = processRegistry.getSession(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    if (session.exited) {
      return { success: false, error: 'Cannot write to exited process' };
    }

    if (!session.stdin) {
      return { success: false, error: 'Session stdin not available' };
    }

    try {
      session.stdin.write(data);
      return { success: true, session: processRegistry.toProcessInfo(session) };
    } catch (err) {
      return { success: false, error: `Failed to write to session: ${(err as Error).message}` };
    }
  }

  /**
   * Send key sequences to session (for PTY sessions)
   */
  private sendKeysToSession(sessionId?: string, keys?: string[]): ProcessActionResult {
    if (!sessionId) {
      return { success: false, error: 'Session ID required for send-keys action' };
    }

    if (!keys || keys.length === 0) {
      return { success: false, error: 'Keys required for send-keys action' };
    }

    const session = processRegistry.getSession(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    if (session.exited) {
      return { success: false, error: 'Cannot send keys to exited process' };
    }

    if (!session.stdin) {
      return { success: false, error: 'Session stdin not available' };
    }

    try {
      // Convert key sequences to their corresponding characters
      for (const key of keys) {
        const keySequence = this.convertKeySequence(key);
        session.stdin.write(keySequence);
      }
      
      return { success: true, session: processRegistry.toProcessInfo(session) };
    } catch (err) {
      return { success: false, error: `Failed to send keys to session: ${(err as Error).message}` };
    }
  }

  /**
   * Kill a session
   */
  private killSession(sessionId?: string): ProcessActionResult {
    if (!sessionId) {
      return { success: false, error: 'Session ID required for kill action' };
    }

    const session = processRegistry.getSession(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    if (session.exited) {
      return { success: false, error: 'Process already exited' };
    }

    const killed = processRegistry.killSession(sessionId);
    if (killed) {
      return { success: true, session: processRegistry.toProcessInfo(session) };
    } else {
      return { success: false, error: 'Failed to kill process (may have already exited)' };
    }
  }

  /**
   * Convert key names to their corresponding character sequences
   */
  private convertKeySequence(key: string): string {
    const keyMap: Record<string, string> = {
      'Enter': '\r',
      'Return': '\r',
      'Tab': '\t',
      'Space': ' ',
      'Escape': '\x1b',
      'Backspace': '\x08',
      'Delete': '\x7f',
      'ArrowUp': '\x1b[A',
      'ArrowDown': '\x1b[B',
      'ArrowRight': '\x1b[C',
      'ArrowLeft': '\x1b[D',
      'Home': '\x1b[H',
      'End': '\x1b[F',
      'PageUp': '\x1b[5~',
      'PageDown': '\x1b[6~',
      'F1': '\x1bOP',
      'F2': '\x1bOQ',
      'F3': '\x1bOR',
      'F4': '\x1bOS',
      'F5': '\x1b[15~',
      'F6': '\x1b[17~',
      'F7': '\x1b[18~',
      'F8': '\x1b[19~',
      'F9': '\x1b[20~',
      'F10': '\x1b[21~',
      'F11': '\x1b[23~',
      'F12': '\x1b[24~',
    };

    // Handle Ctrl+ combinations
    if (key.startsWith('Ctrl+')) {
      const char = key.substring(5).toLowerCase();
      const code = char.charCodeAt(0) - 96; // Ctrl+A = 1, Ctrl+B = 2, etc.
      if (code >= 1 && code <= 26) {
        return String.fromCharCode(code);
      }
    }

    // Return mapped key or the key itself
    return keyMap[key] ?? key;
  }
}

export function createProcessHandler(): ProcessHandler {
  return new ProcessHandler();
}