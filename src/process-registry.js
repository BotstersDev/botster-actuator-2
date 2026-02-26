// @ts-check
/**
 * Process Registry — tracks active and backgrounded shell sessions
 * Maps session IDs to ProcessSession objects with output buffering
 */

export const MAX_OUTPUT_CHARS = 200_000;
export const TAIL_CHARS = 4000;

/**
 * @typedef {{ id: string, command: string, pid?: number, startedAt: number, cwd: string, exited: boolean, exitCode?: number | null, exitSignal?: string | null, backgrounded: boolean, aggregated: string, tail: string, maxOutputChars: number, stdin?: import('node:stream').Writable }} ProcessSession
 */

class ProcessRegistry {
  /** @type {Map<string, ProcessSession>} */
  #sessions = new Map();

  /**
   * Add a new process session
   * @param {string} command
   * @param {string} cwd
   * @param {number} [pid]
   * @returns {ProcessSession}
   */
  addSession(command, cwd, pid) {
    const id = this.#createSessionSlug();
    /** @type {ProcessSession} */
    const session = {
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

    this.#sessions.set(id, session);
    return session;
  }

  /**
   * Get a session by ID
   * @param {string} id
   * @returns {ProcessSession | undefined}
   */
  getSession(id) {
    return this.#sessions.get(id);
  }

  /**
   * List all sessions
   * @returns {ProcessSession[]}
   */
  listSessions() {
    return Array.from(this.#sessions.values());
  }

  /**
   * Mark session as backgrounded
   * @param {string} id
   * @returns {boolean}
   */
  markBackgrounded(id) {
    const session = this.#sessions.get(id);
    if (session) {
      session.backgrounded = true;
      return true;
    }
    return false;
  }

  /**
   * Mark session as exited
   * @param {string} id
   * @param {number | null} [exitCode]
   * @param {string | null} [exitSignal]
   * @returns {boolean}
   */
  markExited(id, exitCode, exitSignal) {
    const session = this.#sessions.get(id);
    if (session) {
      session.exited = true;
      session.exitCode = exitCode;
      session.exitSignal = exitSignal;
      session.stdin = undefined;
      return true;
    }
    return false;
  }

  /**
   * Append output to session (with truncation)
   * @param {string} id
   * @param {string} data
   * @returns {boolean}
   */
  appendOutput(id, data) {
    const session = this.#sessions.get(id);
    if (!session) return false;

    const newOutput = session.aggregated + data;
    if (newOutput.length > session.maxOutputChars) {
      session.aggregated = newOutput.slice(-session.maxOutputChars);
    } else {
      session.aggregated = newOutput;
    }

    this.#updateTail(session);
    return true;
  }

  /**
   * Get tail output for quick polling
   * @param {string} id
   * @returns {string}
   */
  tail(id) {
    const session = this.#sessions.get(id);
    return session?.tail ?? '';
  }

  /**
   * Kill a session
   * @param {string} id
   * @returns {boolean}
   */
  killSession(id) {
    const session = this.#sessions.get(id);
    if (session && session.pid) {
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

        return true;
      } catch (_err) {
        return false;
      }
    }
    return false;
  }

  /**
   * Create a short session slug (8 random chars)
   * @returns {string}
   */
  #createSessionSlug() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    if (this.#sessions.has(result)) {
      return this.#createSessionSlug();
    }

    return result;
  }

  /**
   * Update tail for a session
   * @param {ProcessSession} session
   */
  #updateTail(session) {
    if (session.aggregated.length <= TAIL_CHARS) {
      session.tail = session.aggregated;
    } else {
      session.tail = session.aggregated.slice(-TAIL_CHARS);
    }
  }

  /**
   * Convert ProcessSession to ProcessInfo for protocol
   * @param {ProcessSession} session
   * @returns {import('./protocol.js').ProcessInfo}
   */
  toProcessInfo(session) {
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
