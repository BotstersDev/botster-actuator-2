# botster-actuator

**Hands+Eyes for the Brain-Spine-Actuator model.**

Plain JavaScript (ES modules). No build step. No TypeScript. Source = runtime.

## What It Does

Connects to a [Botster Broker](https://github.com/BotstersDev/botsters-broker) via WebSocket and executes commands on behalf of an agent brain:

- **Shell execution** — run commands with optional PTY, background, timeout
- **File operations** — read, write, edit with path traversal protection
- **Process management** — list, poll, log, write stdin, send keys, kill
- **Brain mode** — ego sidecar that delivers wake events instead of executing commands

## Requirements

- Node.js 18+ (`node --version` to check)
- A running Botster Broker with an actuator registered
- Agent token (`SEKS_BROKER_TOKEN`) and broker URL (`SEKS_BROKER_URL`)

## Install

```bash
git clone https://github.com/BotstersDev/botster-actuator-2.git
cd botster-actuator-2
npm install    # or pnpm install
```

That's it. No build step.

## Register an Actuator in the Broker

Before the actuator can connect, it needs to be registered in the broker database. This creates an actuator record and assigns it to an agent.

You'll need access to the broker's SQLite database or admin API. Example using the broker DB directly:

```bash
# On the broker machine (e.g., VPS)
sqlite3 /opt/broker/data/broker.db

-- Create actuator record
INSERT INTO actuators (id, account_id, name, type, status, enabled, created_at)
VALUES ('<actuator-id>', '<account-id>', '<friendly-name>', 'vps', 'offline', 1, datetime('now'));

-- Assign to agent
INSERT INTO agent_actuator_assignments (agent_id, actuator_id, enabled, created_at)
VALUES ('<agent-id>', '<actuator-id>', 1, datetime('now'));
```

The `<actuator-id>` must match the `--id` flag you pass to the actuator.

The actuator authenticates using the **agent token** (same `SEKS_BROKER_TOKEN` the brain uses). The broker verifies the token, then checks that the actuator ID is assigned to that agent.

## Run

```bash
# Standard mode — execute commands from the broker
SEKS_BROKER_URL=https://broker-internal.seksbot.com \
SEKS_BROKER_TOKEN=seks_agent_xxx \
node src/index.js --id my-actuator --cwd /path/to/workspace

# Brain mode — ego sidecar, delivers wake events only
SEKS_BROKER_URL=https://broker-internal.seksbot.com \
SEKS_BROKER_TOKEN=seks_agent_xxx \
node src/index.js --id my-ego --brain --webhook-port 18789 --cwd /home/agent
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--id <name>` | Actuator ID (must match broker registration) | hostname |
| `--cwd <path>` | Working directory for commands | current directory |
| `--brain` | Brain mode (no command execution, wake delivery only) | off |
| `--webhook-port <port>` | Port for wake delivery in brain mode | none |
| `--capabilities <c>` | Comma-separated capabilities (informational) | actuator/shell |
| `--help` | Show help | |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SEKS_BROKER_URL` | yes | Broker URL (e.g., `https://broker-internal.seksbot.com`) |
| `SEKS_BROKER_TOKEN` | yes | Agent token for authentication |
| `EGO_BRAIN_MODE` | no | Set to `1` to enable brain mode (alternative to `--brain`) |
| `EGO_WEBHOOK_PORT` | no | Webhook port for brain mode (alternative to `--webhook-port`) |

## Run as a systemd Service

```ini
[Unit]
Description=Botster Actuator
After=network.target

[Service]
Type=simple
User=your-user
ExecStart=/usr/bin/node /opt/botster-actuator-2/src/index.js --id my-actuator --cwd /home/your-user
WorkingDirectory=/opt/botster-actuator-2
Restart=always
RestartSec=5
Environment=SEKS_BROKER_URL=https://broker-internal.seksbot.com
Environment=SEKS_BROKER_TOKEN=seks_agent_xxx

[Install]
WantedBy=multi-user.target
```

## Run as a macOS launchd Service

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.botsters.actuator</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/node</string>
        <string>/path/to/botster-actuator-2/src/index.js</string>
        <string>--id</string>
        <string>my-actuator</string>
        <string>--cwd</string>
        <string>/Users/you/workspace</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>SEKS_BROKER_URL</key>
        <string>https://broker-internal.seksbot.com</string>
        <key>SEKS_BROKER_TOKEN</key>
        <string>seks_agent_xxx</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/botster-actuator.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/botster-actuator.err</string>
</dict>
</plist>
```

Save to `~/Library/LaunchAgents/com.botsters.actuator.plist`, then:

```bash
launchctl load ~/Library/LaunchAgents/com.botsters.actuator.plist
```

## Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────────┐
│  Brain   │────▸│  Broker  │────▸│  Actuator    │  ← this project
│ (OpenClaw)│     │ (Spine)  │     │ (Hands+Eyes) │
└──────────┘     └──────────┘     └──────────────┘
```

The actuator is a WebSocket client that:
1. Connects to the broker with an agent token
2. Receives commands (shell, file, process operations)
3. Executes them locally and sends results back

In **brain mode** (`--brain`), it doesn't execute commands. Instead, it receives wake events from the broker and forwards them to the local OpenClaw brain via HTTP webhook.

## Wire Protocol

See `src/protocol.js` for the full type definitions (JSDoc).

## License

MIT
