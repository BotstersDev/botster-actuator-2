# AGENTS.md — Codex Task

## Task

Convert the TypeScript actuator in `spec/` to plain JavaScript (ES modules) in `src/`.

## Rules

1. **No TypeScript syntax anywhere** — no `:`, no `as`, no `interface`, no `type` keyword, no generics
2. **`// @ts-check` at top of every `.js` file**
3. **JSDoc annotations** on all exported functions, classes, and important variables
4. **ES2022 private fields** (`#`) for private class members
5. **ES modules** — `import`/`export`, not `require`
6. **Result must run:** `node src/index.js --help` must print usage and exit
7. **No build step.** No TypeScript, no bundler, no compilation.
8. **No `dist/` directory.**
9. **No feature additions** — exact behavioral parity with the TypeScript spec files

## Source → Target Mapping

| TypeScript (spec/) | JavaScript (src/) |
|---|---|
| `spec/index.ts` | `src/index.js` |
| `spec/actuator.ts` | `src/actuator.js` |
| `spec/protocol.ts` | `src/protocol.js` |
| `spec/reconnect.ts` | `src/reconnect.js` |
| `spec/process-registry.ts` | `src/process-registry.js` |
| `spec/executors/shell.ts` | `src/executors/shell.js` |
| `spec/executors/files.ts` | `src/executors/files.js` |
| `spec/executors/process-handler.ts` | `src/executors/process-handler.js` |

## Conversion Pattern

For each file:
1. Copy the `.ts` file content
2. Remove all TypeScript-specific syntax:
   - `interface Foo { ... }` → JSDoc `/** @typedef {{ ... }} Foo */`
   - `: string` parameter/return annotations → remove, add JSDoc
   - `as Type` casts → remove
   - `type Foo = ...` → JSDoc `/** @typedef {...} Foo */`
   - Import type-only: `import type { X }` → remove or `/** @import { X } from '...' */`
3. Convert `private` keyword → `#` prefix on fields/methods
4. Fix import paths: `.js` extensions (already present in the TS imports)
5. Add `// @ts-check` at the very top
6. Ensure `#!/usr/bin/env node` on `index.js`

## Dependencies

- `ws` — WebSocket client (same as current)
- `@lydell/node-pty` — optional, for PTY support (graceful fallback if unavailable)
- Everything else is Node.js stdlib (`node:os`, `node:fs`, `node:path`, `node:child_process`, `node:stream`)

## Verification

After conversion, these must work:
- `node src/index.js --help` → prints usage, exits 0
- `node src/index.js` (without env vars) → prints error about missing SEKS_BROKER_URL, exits 1
- No syntax errors on any file
