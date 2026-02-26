// @ts-check
/**
 * Wire protocol types for actuator ↔ broker communication
 * Must match seks-broker-2 (BotstersDev/botsters-broker)
 *
 * This file contains only JSDoc typedefs — no runtime code.
 */

// ─── Broker → Actuator ────────────────────────────────────────────────────────

/**
 * @typedef {{ command: string, cwd?: string, timeout?: number, env?: Record<string, string>, pty?: boolean, background?: boolean, yieldMs?: number }} ExecPayload
 */

/**
 * @typedef {{ action: 'list' | 'poll' | 'log' | 'write' | 'send-keys' | 'kill', sessionId?: string, data?: string, keys?: string[], offset?: number, limit?: number }} ProcessPayload
 */

/**
 * @typedef {{ path: string, offset?: number, limit?: number }} ReadPayload
 */

/**
 * @typedef {{ path: string, content: string }} WritePayload
 */

/**
 * @typedef {{ path: string, oldText: string, newText: string }} EditPayload
 */

/**
 * @typedef {{ type: 'command_delivery', id: string, capability: string, payload: any }} CommandDelivery
 */

/**
 * @typedef {{ type: 'ping', ts: number }} PingMessage
 */

/**
 * @typedef {{ type: 'error', code: string, message: string, ref_id?: string }} ErrorMessage
 */

/**
 * @typedef {{ type: 'wake', text: string, source: string, ts: string }} WakeDelivery
 */

/**
 * @typedef {CommandDelivery | PingMessage | ErrorMessage | WakeDelivery} ActuatorInbound
 */

// ─── Actuator → Broker ────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, command: string, pid?: number, startedAt: number, cwd: string, exited: boolean, exitCode?: number | null, exitSignal?: string | null, backgrounded: boolean }} ProcessInfo
 */

/**
 * @typedef {{ type: 'command_result', id: string, status: 'completed' | 'failed' | 'running', result: any }} CommandResult
 */

/**
 * @typedef {{ type: 'pong', ts: number }} PongMessage
 */

/**
 * @typedef {{ type: 'command_stream', id: string, stream: 'stdout' | 'stderr', data: string }} CommandStream
 */

/**
 * @typedef {CommandResult | PongMessage | CommandStream} ActuatorOutbound
 */

export {};
