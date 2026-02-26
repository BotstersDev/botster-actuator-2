/**
 * Core Actuator — connects to broker via WebSocket, executes commands
 * Protocol matches seks-broker-2 (BotstersDev/botsters-broker)
 */
import WebSocket from 'ws';
import { hostname } from 'node:os';
import { ReconnectManager } from './reconnect.js';
import { executeShell } from './executors/shell.js';
import { createFileExecutor } from './executors/files.js';
import { createProcessHandler } from './executors/process-handler.js';
import type { 
  CommandDelivery, 
  ExecPayload, 
  ProcessPayload, 
  ReadPayload, 
  WritePayload, 
  EditPayload,
  CommandResult 
} from './protocol.js';

export interface ActuatorConfig {
  brokerUrl: string;       // e.g. https://broker-internal.seksbot.com
  agentToken: string;
  actuatorId: string;      // must be pre-registered in broker DB
  capabilities?: string[]; // informational, broker already knows from DB
  cwd?: string;            // default working directory for commands
  brainMode?: boolean;     // If true, this is a brain sidecar — no command execution
  webhookPort?: number;    // Port for wake delivery: POST http://localhost:{port}/hooks/wake
}

// Import protocol types
import type { ActuatorInbound, PingMessage, ErrorMessage, WakeDelivery } from './protocol.js';

type InboundMessage = ActuatorInbound;

export class Actuator {
  private ws: WebSocket | null = null;
  private reconnect: ReconnectManager;
  private activeCommands = new Map<string, () => void>(); // id → kill fn
  private destroyed = false;
  private readonly cwd: string;
  private readonly fileExecutor;
  private readonly processHandler;

  constructor(private config: ActuatorConfig) {
    this.cwd = config.cwd ?? process.cwd();
    this.reconnect = new ReconnectManager();
    this.fileExecutor = createFileExecutor(this.cwd);
    this.processHandler = createProcessHandler();
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.destroyed = true;
    this.reconnect.destroy();
    for (const kill of this.activeCommands.values()) kill();
    this.activeCommands.clear();
    if (this.ws) {
      this.ws.close(1000, 'actuator shutting down');
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.destroyed) return;

    const base = this.config.brokerUrl.replace(/^http/, 'ws');
    const wsUrl = `${base}/ws?token=${encodeURIComponent(this.config.agentToken)}&role=actuator&actuator_id=${encodeURIComponent(this.config.actuatorId)}`;
    console.log(`[actuator] Connecting to ${base}/ws as ${this.config.actuatorId}`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error(`[actuator] Failed to create WebSocket:`, err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log(`[actuator] Connected and authenticated as ${this.config.actuatorId}`);
      this.reconnect.reset();
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as InboundMessage;
        this.handleMessage(msg);
      } catch (err) {
        console.error(`[actuator] Invalid message:`, err);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[actuator] Disconnected: ${code} ${reason}`);
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error(`[actuator] WebSocket error:`, err.message);
    });
  }

  private handleMessage(msg: InboundMessage): void {
    switch (msg.type) {
      case 'command_delivery':
        this.handleCommand(msg);
        break;
      case 'ping':
        this.send({ type: 'pong', ts: msg.ts });
        break;
      case 'wake':
        this.handleWake(msg as WakeDelivery);
        break;
      case 'error':
        console.error(`[actuator] Broker error [${msg.code}]: ${msg.message}`);
        break;
      default:
        console.warn(`[actuator] Unknown message type: ${(msg as any).type}`);
    }
  }

  private async handleCommand(msg: CommandDelivery): Promise<void> {
    const { id, capability, payload } = msg;

    if (this.config.brainMode) {
      this.sendResult(id, 'failed', { error: 'Brain-mode actuator does not execute commands' });
      return;
    }

    console.log(`[actuator] Command ${id}: ${capability}`);

    switch (capability) {
      case 'exec':
        await this.handleExecCommand(id, payload as ExecPayload);
        break;
      
      case 'process':
        this.handleProcessCommand(id, payload as ProcessPayload);
        break;
      
      case 'read':
        this.handleReadCommand(id, payload as ReadPayload);
        break;
      
      case 'write':
        this.handleWriteCommand(id, payload as WritePayload);
        break;
      
      case 'edit':
        this.handleEditCommand(id, payload as EditPayload);
        break;
      
      // Legacy support for old capability names
      case 'actuator/shell':
      case 'shell':
        const legacyPayload = payload as { command?: string; cwd?: string; timeout?: number; env?: Record<string, string> };
        if (legacyPayload.command) {
          await this.handleExecCommand(id, { command: legacyPayload.command, cwd: legacyPayload.cwd, timeout: legacyPayload.timeout, env: legacyPayload.env });
        } else {
          this.sendResult(id, 'failed', { error: 'No command specified' });
        }
        break;
      
      default:
        this.sendResult(id, 'failed', { error: `Unsupported capability: ${capability}` });
    }
  }

  private async handleExecCommand(id: string, payload: ExecPayload): Promise<void> {
    if (!payload.command) {
      this.sendResult(id, 'failed', { error: 'No command specified' });
      return;
    }

    let stdout = '';
    let stderr = '';

    try {
      const session = await executeShell(
        {
          command: payload.command,
          cwd: payload.cwd ?? this.cwd,
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
            this.activeCommands.delete(id);
            this.sendResult(id, exitCode === 0 ? 'completed' : 'failed', {
              stdout,
              stderr,
              exitCode,
              durationMs,
              sessionId: session?.id,
              pid: session?.pid
            });
          },
          onError: (error, session) => {
            this.activeCommands.delete(id);
            this.sendResult(id, 'failed', {
              error,
              stdout,
              stderr,
              sessionId: session?.id,
              pid: session?.pid
            });
          },
          onYield: (session) => {
            // Command yielded to background, return 'running' status
            this.sendResult(id, 'running', {
              sessionId: session.id,
              pid: session.pid,
              stdout,
              stderr
            });
          }
        }
      );

      // Set up kill function for this session
      this.activeCommands.set(id, () => {
        if (session.pid && !session.exited) {
          try {
            process.kill(session.pid, 'SIGTERM');
          } catch (err) {
            // Process might have already exited
          }
        }
      });

    } catch (err) {
      this.sendResult(id, 'failed', { error: `Failed to execute command: ${(err as Error).message}` });
    }
  }

  private handleProcessCommand(id: string, payload: ProcessPayload): void {
    const result = this.processHandler.handle(payload);
    
    if (result.success) {
      this.sendResult(id, 'completed', {
        sessions: result.sessions,
        tail: result.tail,
        content: result.output
      });
    } else {
      this.sendResult(id, 'failed', { error: result.error });
    }
  }

  private handleReadCommand(id: string, payload: ReadPayload): void {
    const result = this.fileExecutor.read(payload);
    
    if (result.success) {
      this.sendResult(id, 'completed', { content: result.content });
    } else {
      this.sendResult(id, 'failed', { error: result.error });
    }
  }

  private handleWriteCommand(id: string, payload: WritePayload): void {
    const result = this.fileExecutor.write(payload);
    
    if (result.success) {
      this.sendResult(id, 'completed', {});
    } else {
      this.sendResult(id, 'failed', { error: result.error });
    }
  }

  private handleEditCommand(id: string, payload: EditPayload): void {
    const result = this.fileExecutor.edit(payload);
    
    if (result.success) {
      this.sendResult(id, 'completed', {});
    } else {
      this.sendResult(id, 'failed', { error: result.error });
    }
  }

  private async handleWake(msg: WakeDelivery): Promise<void> {
    if (!this.config.webhookPort) {
      console.warn('[actuator] Received wake but no webhookPort configured — dropping');
      return;
    }
    const url = `http://localhost:${this.config.webhookPort}/hooks/wake`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg.text, source: msg.source, ts: msg.ts }),
        signal: AbortSignal.timeout(5000),
      });
      console.log(`[actuator] Wake delivered to ${url}: ${res.status}`);
    } catch (err) {
      console.error(`[actuator] Wake delivery failed to ${url}:`, (err as Error).message);
      // Best-effort only — do not retry, do not crash
    }
  }

  private sendResult(id: string, status: 'completed' | 'failed' | 'running', result: any): void {
    const commandResult: CommandResult = {
      type: 'command_result',
      id,
      status,
      result
    };
    this.send(commandResult);
  }

  private send(msg: Record<string, unknown> | CommandResult): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (!this.reconnect.schedule(() => this.connect())) {
      console.error(`[actuator] Max reconnection attempts reached`);
    }
  }
}
