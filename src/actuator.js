// @ts-check
/**
 * Core Actuator — connects to broker via WebSocket, executes commands
 * Protocol matches seks-broker-2 (BotstersDev/botsters-broker)
 */
import WebSocket from 'ws';
import { ReconnectManager } from './reconnect.js';
import { executeShell } from './executors/shell.js';
import { createFileExecutor } from './executors/files.js';
import { createProcessHandler } from './executors/process-handler.js';

/**
 * @typedef {{ brokerUrl: string, agentToken: string, actuatorId: string, capabilities?: string[], cwd?: string, brainMode?: boolean, webhookPort?: number }} ActuatorConfig
 */

export class Actuator {
  /** @type {WebSocket | null} */
  #ws = null;
  #reconnect;
  /** @type {Map<string, () => void>} */
  #activeCommands = new Map();
  #destroyed = false;
  #cwd;
  #fileExecutor;
  #processHandler;
  #config;

  /** @param {ActuatorConfig} config */
  constructor(config) {
    this.#config = config;
    this.#cwd = config.cwd ?? process.cwd();
    this.#reconnect = new ReconnectManager();
    this.#fileExecutor = createFileExecutor(this.#cwd);
    this.#processHandler = createProcessHandler();
  }

  start() {
    this.#connect();
  }

  stop() {
    this.#destroyed = true;
    this.#reconnect.destroy();
    for (const kill of this.#activeCommands.values()) kill();
    this.#activeCommands.clear();
    if (this.#ws) {
      this.#ws.close(1000, 'actuator shutting down');
      this.#ws = null;
    }
  }

  #connect() {
    if (this.#destroyed) return;

    const base = this.#config.brokerUrl.replace(/^http/, 'ws');
    const wsUrl = `${base}/ws?token=${encodeURIComponent(this.#config.agentToken)}&role=actuator&actuator_id=${encodeURIComponent(this.#config.actuatorId)}`;
    console.log(`[actuator] Connecting to ${base}/ws as ${this.#config.actuatorId}`);

    try {
      this.#ws = new WebSocket(wsUrl);
    } catch (_err) {
      console.error(`[actuator] Failed to create WebSocket:`, _err);
      this.#scheduleReconnect();
      return;
    }

    this.#ws.on('open', () => {
      console.log(`[actuator] Connected and authenticated as ${this.#config.actuatorId}`);
      this.#reconnect.reset();
    });

    this.#ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.#handleMessage(msg);
      } catch (_err) {
        console.error(`[actuator] Invalid message:`, _err);
      }
    });

    this.#ws.on('close', (code, reason) => {
      console.log(`[actuator] Disconnected: ${code} ${reason}`);
      this.#ws = null;
      this.#scheduleReconnect();
    });

    this.#ws.on('error', (err) => {
      console.error(`[actuator] WebSocket error:`, err.message);
    });
  }

  /**
   * @param {import('./protocol.js').ActuatorInbound} msg
   */
  #handleMessage(msg) {
    switch (msg.type) {
      case 'command_delivery':
        this.#handleCommand(msg);
        break;
      case 'ping':
        this.#send({ type: 'pong', ts: msg.ts });
        break;
      case 'wake':
        this.#handleWake(msg);
        break;
      case 'error':
        console.error(`[actuator] Broker error [${msg.code}]: ${msg.message}`);
        break;
      default:
        console.warn(`[actuator] Unknown message type: ${/** @type {any} */ (msg).type}`);
    }
  }

  /**
   * @param {import('./protocol.js').CommandDelivery} msg
   */
  async #handleCommand(msg) {
    const { id, capability, payload } = msg;

    if (this.#config.brainMode) {
      this.#sendResult(id, 'failed', { error: 'Brain-mode actuator does not execute commands' });
      return;
    }

    console.log(`[actuator] Command ${id}: ${capability}`);

    switch (capability) {
      case 'exec':
        await this.#handleExecCommand(id, payload);
        break;
      case 'process':
        this.#handleProcessCommand(id, payload);
        break;
      case 'read':
        this.#handleReadCommand(id, payload);
        break;
      case 'write':
        this.#handleWriteCommand(id, payload);
        break;
      case 'edit':
        this.#handleEditCommand(id, payload);
        break;
      // Legacy support
      case 'actuator/shell':
      case 'shell': {
        if (payload.command) {
          await this.#handleExecCommand(id, { command: payload.command, cwd: payload.cwd, timeout: payload.timeout, env: payload.env });
        } else {
          this.#sendResult(id, 'failed', { error: 'No command specified' });
        }
        break;
      }
      default:
        this.#sendResult(id, 'failed', { error: `Unsupported capability: ${capability}` });
    }
  }

  /**
   * @param {string} id
   * @param {import('./protocol.js').ExecPayload} payload
   */
  async #handleExecCommand(id, payload) {
    if (!payload.command) {
      this.#sendResult(id, 'failed', { error: 'No command specified' });
      return;
    }

    let stdout = '';
    let stderr = '';

    try {
      const session = await executeShell(
        {
          command: payload.command,
          cwd: payload.cwd ?? this.#cwd,
          timeout: payload.timeout,
          env: payload.env,
          pty: payload.pty,
          background: payload.background,
          yieldMs: payload.yieldMs,
        },
        {
          onStdout: (data) => { stdout += data; },
          onStderr: (data) => { stderr += data; },
          onDone: (exitCode, durationMs, session) => {
            this.#activeCommands.delete(id);
            this.#sendResult(id, exitCode === 0 ? 'completed' : 'failed', {
              stdout,
              stderr,
              exitCode,
              durationMs,
              sessionId: session?.id,
              pid: session?.pid
            });
          },
          onError: (error, session) => {
            this.#activeCommands.delete(id);
            this.#sendResult(id, 'failed', {
              error,
              stdout,
              stderr,
              sessionId: session?.id,
              pid: session?.pid
            });
          },
          onYield: (session) => {
            this.#sendResult(id, 'running', {
              sessionId: session.id,
              pid: session.pid,
              stdout,
              stderr
            });
          }
        }
      );

      this.#activeCommands.set(id, () => {
        if (session.pid && !session.exited) {
          try {
            process.kill(session.pid, 'SIGTERM');
          } catch (_err) {
            // Process might have already exited
          }
        }
      });
    } catch (err) {
      this.#sendResult(id, 'failed', { error: `Failed to execute command: ${/** @type {Error} */ (err).message}` });
    }
  }

  /**
   * @param {string} id
   * @param {import('./protocol.js').ProcessPayload} payload
   */
  #handleProcessCommand(id, payload) {
    const result = this.#processHandler.handle(payload);

    if (result.success) {
      this.#sendResult(id, 'completed', {
        sessions: result.sessions,
        tail: result.tail,
        content: result.output
      });
    } else {
      this.#sendResult(id, 'failed', { error: result.error });
    }
  }

  /**
   * @param {string} id
   * @param {import('./protocol.js').ReadPayload} payload
   */
  #handleReadCommand(id, payload) {
    const result = this.#fileExecutor.read(payload);

    if (result.success) {
      this.#sendResult(id, 'completed', { content: result.content });
    } else {
      this.#sendResult(id, 'failed', { error: result.error });
    }
  }

  /**
   * @param {string} id
   * @param {import('./protocol.js').WritePayload} payload
   */
  #handleWriteCommand(id, payload) {
    const result = this.#fileExecutor.write(payload);

    if (result.success) {
      this.#sendResult(id, 'completed', {});
    } else {
      this.#sendResult(id, 'failed', { error: result.error });
    }
  }

  /**
   * @param {string} id
   * @param {import('./protocol.js').EditPayload} payload
   */
  #handleEditCommand(id, payload) {
    const result = this.#fileExecutor.edit(payload);

    if (result.success) {
      this.#sendResult(id, 'completed', {});
    } else {
      this.#sendResult(id, 'failed', { error: result.error });
    }
  }

  /**
   * @param {import('./protocol.js').WakeDelivery} msg
   */
  async #handleWake(msg) {
    if (!this.#config.webhookPort) {
      console.warn('[actuator] Received wake but no webhookPort configured — dropping');
      return;
    }
    const url = `http://localhost:${this.#config.webhookPort}/hooks/wake`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg.text, source: msg.source, ts: msg.ts }),
        signal: AbortSignal.timeout(5000),
      });
      console.log(`[actuator] Wake delivered to ${url}: ${res.status}`);
    } catch (err) {
      console.error(`[actuator] Wake delivery failed to ${url}:`, /** @type {Error} */ (err).message);
    }
  }

  /**
   * @param {string} id
   * @param {'completed' | 'failed' | 'running'} status
   * @param {any} result
   */
  #sendResult(id, status, result) {
    this.#send({ type: 'command_result', id, status, result });
  }

  /**
   * @param {Record<string, unknown>} msg
   */
  #send(msg) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(msg));
    }
  }

  #scheduleReconnect() {
    if (this.#destroyed) return;
    if (!this.#reconnect.schedule(() => this.#connect())) {
      console.error(`[actuator] Max reconnection attempts reached`);
    }
  }
}
