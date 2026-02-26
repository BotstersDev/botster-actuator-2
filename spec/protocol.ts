/**
 * Wire protocol types for actuator ↔ broker communication
 * Must match seks-broker-2 (BotstersDev/botsters-broker) src/protocol.ts
 */

// ─── Broker → Actuator ────────────────────────────────────────────────────────

/** Exec command payload */
export interface ExecPayload {
  command: string;
  cwd?: string;
  timeout?: number;      // seconds
  env?: Record<string, string>;
  pty?: boolean;
  background?: boolean;
  yieldMs?: number;
}

/** Process command payload */
export interface ProcessPayload {
  action: 'list' | 'poll' | 'log' | 'write' | 'send-keys' | 'kill';
  sessionId?: string;
  data?: string;         // for write
  keys?: string[];       // for send-keys
  offset?: number;       // for log
  limit?: number;        // for log
}

/** Read file payload */
export interface ReadPayload {
  path: string;
  offset?: number;
  limit?: number;
}

/** Write file payload */
export interface WritePayload {
  path: string;
  content: string;
}

/** Edit file payload */
export interface EditPayload {
  path: string;
  oldText: string;
  newText: string;
}

/** Broker delivers a command for the actuator to execute */
export interface CommandDelivery {
  type: 'command_delivery';
  id: string;
  capability: 'exec' | 'process' | 'read' | 'write' | 'edit' | 'actuator/shell' | 'shell' | string;
  payload: ExecPayload | ProcessPayload | ReadPayload | WritePayload | EditPayload | any;
}

/** Broker keepalive ping */
export interface PingMessage {
  type: 'ping';
  ts: number;
}

/** Broker error notification */
export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
  ref_id?: string;
}

/** Broker delivers a wake event for the co-located brain */
export interface WakeDelivery {
  type: 'wake';
  text: string;
  source: string;
  ts: string;
}

export type ActuatorInbound = CommandDelivery | PingMessage | ErrorMessage | WakeDelivery;

// ─── Actuator → Broker ────────────────────────────────────────────────────────

/** Process session info */
export interface ProcessInfo {
  id: string;
  command: string;
  pid?: number;
  startedAt: number;
  cwd: string;
  exited: boolean;
  exitCode?: number | null;
  exitSignal?: string | null;
  backgrounded: boolean;
}

/** Command execution result (batched — sent after completion) */
export interface CommandResult {
  type: 'command_result';
  id: string;
  status: 'completed' | 'failed' | 'running';
  result: {
    // exec results
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    durationMs?: number;
    error?: string;
    sessionId?: string;   // when backgrounded
    pid?: number;
    // file results
    content?: string;
    // process results
    sessions?: ProcessInfo[];
    tail?: string;
  };
}

/** Keepalive pong */
export interface PongMessage {
  type: 'pong';
  ts: number;
}

/** Streaming output (Phase 2) */
export interface CommandStream {
  type: 'command_stream';
  id: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

export type ActuatorOutbound = CommandResult | PongMessage | CommandStream;

// ─── Future: Streaming (not yet implemented) ──────────────────────────────────
// When streaming is added, these will be sent incrementally instead of batching:
//
// export interface CommandStdout {
//   type: 'command_stdout';
//   id: string;
//   data: string;
// }
//
// export interface CommandStderr {
//   type: 'command_stderr';
//   id: string;
//   data: string;
// }
//
// export interface CommandDone {
//   type: 'command_done';
//   id: string;
//   exitCode: number;
//   durationMs: number;
// }
