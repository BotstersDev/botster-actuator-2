#!/usr/bin/env node
/**
 * seks-actuator — Hands+Eyes for the brain-spine-actuator model
 *
 * Usage:
 *   SEKS_BROKER_URL=https://broker-internal.seksbot.com \
 *   SEKS_BROKER_TOKEN=seks_agent_xxx \
 *   seks-actuator [--id my-actuator] [--cwd /data/workspace]
 */
import { hostname } from 'node:os';
import { Actuator } from './actuator.js';

function usage(): never {
  console.error(`
seks-actuator — Connect to the SEKS broker as an actuator (Hands+Eyes)

Environment:
  SEKS_BROKER_URL    Broker URL (required)
  SEKS_BROKER_TOKEN  Agent token (required)
  EGO_BRAIN_MODE     Set to '1' to enable brain mode
  EGO_WEBHOOK_PORT   Webhook port for wake delivery (brain mode)

Options:
  --id <name>           Actuator ID (default: hostname)
  --cwd <path>          Working directory for commands (default: cwd)
  --capabilities <c>    Comma-separated capabilities (default: actuator/shell)
  --brain               Enable brain mode (no command execution, wake delivery only)
  --webhook-port <port> Webhook port for wake delivery (brain mode)
  --help                Show this help
`.trim());
  process.exit(1);
}

function parseArgs(args: string[]): {
  id?: string;
  cwd?: string;
  capabilities?: string[];
  brain?: boolean;
  webhookPort?: number;
} {
  const result: { id?: string; cwd?: string; capabilities?: string[]; brain?: boolean; webhookPort?: number } = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--id':
        result.id = args[++i];
        break;
      case '--cwd':
        result.cwd = args[++i];
        break;
      case '--capabilities':
        result.capabilities = args[++i]?.split(',');
        break;
      case '--brain':
        result.brain = true;
        break;
      case '--webhook-port':
        result.webhookPort = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        usage();
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        usage();
    }
  }
  return result;
}

const brokerUrl = process.env.SEKS_BROKER_URL;
const agentToken = process.env.SEKS_BROKER_TOKEN;

if (!brokerUrl || !agentToken) {
  console.error('Error: SEKS_BROKER_URL and SEKS_BROKER_TOKEN must be set');
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));

const brainMode = opts.brain || process.env.EGO_BRAIN_MODE === '1';
const webhookPort = opts.webhookPort
  ?? (process.env.EGO_WEBHOOK_PORT ? parseInt(process.env.EGO_WEBHOOK_PORT, 10) : undefined);

const actuator = new Actuator({
  brokerUrl,
  agentToken,
  actuatorId: opts.id ?? hostname(),
  capabilities: opts.capabilities,
  cwd: opts.cwd,
  brainMode,
  webhookPort,
});

// Graceful shutdown
function shutdown() {
  console.log('\n[actuator] Shutting down...');
  actuator.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (brainMode) {
  console.log(`[actuator] Brain mode — webhook delivery to localhost:${webhookPort || '(not set)'}`);
}
console.log(`[actuator] Starting — broker: ${brokerUrl}, id: ${opts.id ?? '(hostname)'}`);
actuator.start();
