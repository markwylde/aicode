# aicode

Interactive AI coding REPL that connects to OpenRouter models and optional Model Context Protocol (MCP) tools. Chat with the assistant, browse your workspace tree, tweak model/provider at runtime, manage logs, and start/stop MCP servers from within the session.

## Features

- Chat REPL with streaming responses
- Runtime commands for model, provider, logging, and ignore patterns
- Directory tree printer with simple glob ignores
- MCP integration: start/stop servers and expose their tools to the AI
- Config file support and CLI flags for overrides
- Structured logging via `pino` with optional file output

## Requirements

- Node.js 22+
- An OpenRouter API key in the `OPENROUTER_API_KEY` environment variable
- (Optional) One or more MCP servers available on your system

## Quick Start

```bash
npm install --global @markwylde/aicode
aicode
```

Then add your config to ~/.aicode/config.json

```json
{
	"ignore": ["node_modules", "dist", "coverage", ".git", ".DS_Store", "*.log"],
	"model": "qwen/qwen3-32b",
	"provider": "cerebras",
	"logLevel": "debug",
	"logFile": "debug.log",
	"mcp": [
		"npx -y @modelcontextprotocol/server-filesystem /Users/someuser/somefolder",
		"npx -y @modelcontextprotocol/server-sequential-thinking"
	]
}
```

## Usage

Run the CLI:

```bash
aicode --model qwen/qwen3-32b --provider cerebras
```

CLI flags mirror the config file options (see Configuration):

- `--model <name>`: Set model ID (e.g., `qwen/qwen3-32b`)
- `--provider <name>`: Set provider filter
- `--log-level <level>`: One of `fatal|error|warn|info|debug|trace`
- `--log-file <path>`: Enable file logging to `<path>`
- `--ignore <pattern>`: Add ignored name/glob (repeatable)
- `--mcp <command>`: Start an MCP server (repeatable)

Examples:

```bash
# Start with model/provider + logging
aicode \
  --model qwen/qwen3-32b \
  --provider cerebras \
  --log-level debug \
  --log-file debug.log

# Start and attach an MCP server
aicode \
  --mcp "npx -y @modelcontextprotocol/server-filesystem ./sandbox" \
  --mcp "npx -y @modelcontextprotocol/server-sequential-thinking"
```

## Commands

Type `/help` in the REPL to list commands. Available commands include:

- `/hello`: Print a greeting
- `/cwd [path]`: Show or change the working directory
- `/tree`: Print a recursive tree of the current directory
- `/model [name]`: Show or set the current model
- `/provider [name]`: Show or set the provider filter
- `/log-level [level]`: Show or set log level
- `/log-file [path]`: Show or set log file
- `/ignore [pattern]`: Add an ignore pattern (e.g., `node_modules`, `*.log`)
- `/unignore [pattern]`: Remove an ignore pattern
- `/clear`: Clear the terminal
- `/mcp [stop <cmd>|stop-all|<command>]`: List/start/stop MCP servers
- `/exit` or `/quit`: Exit the REPL

Unrecognized input is treated as a chat message to the AI.

## Configuration

At startup the app looks for a config file in this order and merges it with CLI flags (CLI wins):

1) Project: `./.aicode/config.json`
2) Home: `~/.aicode/config.json` (used if no project config)

Example:

```json
{
  "ignore": ["node_modules", "dist", "coverage", ".git", ".DS_Store", "*.log"],
  "model": "qwen/qwen3-32b",
  "provider": "cerebras",
  "logLevel": "debug",
  "logFile": "debug.log",
  "mcp": [
    "npx -y @modelcontextprotocol/server-filesystem ./sandbox",
    "npx -y @modelcontextprotocol/server-sequential-thinking"
  ]
}
```

- `ignore`: Names or simple globs excluded by `/tree`
- `model`: Default model ID for OpenRouter
- `provider`: Optional provider constraint
- `logLevel`: `fatal|error|warn|info|debug|trace`
- `logFile`: Enables async file logging when set
- `mcp`: Commands to start MCP servers on launch

## MCP Integration

When MCP servers are running, their tools are exposed to the AI using JSON Schema → Zod conversion. You can manage servers via:

- Startup config: add commands under `mcp` in `.aicode/config.json`
- CLI flags: repeat `--mcp "<command>"` for each server
- Runtime: `/mcp <command>`, `/mcp stop <command>`, `/mcp stop-all`

Notes:

- Commands are executed via your shell; ensure they are installed and runnable.
- Some `npx`-based servers require network access to download packages the first time.

## Logging

Logging uses `pino`.

- Default level is `warn` and logs are discarded unless `logFile` is set
- Set `--log-level` and `--log-file` (or use `/log-level` and `/log-file` at runtime)
- Logs include stream states, tool calls, MCP messages, and errors

## Development

Useful scripts:

```bash
# Lint
npm run lint

# Format
npm run format

# Biome check (lint+format+more)
npm run check

# Tidy everything (format+lint+check with --write)
npm run tidy
```

Run from source:

```bash
# Install dependencies
npm install

# Export your OpenRouter API key
# macOS/Linux
export OPENROUTER_API_KEY=your_key_here
# Windows (PowerShell)
$Env:OPENROUTER_API_KEY="your_key_here"

# Start locally
npm run dev
# or run via Node directly
node --experimental-strip-types src/main.ts --model qwen/qwen3-32b --provider cerebras

# Start and attach an MCP server
node --experimental-strip-types src/main.ts \
  --mcp "npx -y @modelcontextprotocol/server-filesystem ./sandbox" \
  --mcp "npx -y @modelcontextprotocol/server-sequential-thinking"
```

Implementation note: The CLI entrypoint is TypeScript executed by Node with `--experimental-strip-types`.

Project layout:

```
src/
  main.ts            # Entry point / REPL wiring
  service/repl.ts    # Command routing and readline shell
  utils/ai.ts        # OpenRouter thread and streaming
  utils/config.ts    # CLI+file config parsing
  utils/logger.ts    # pino logger setup
  utils/mcp.ts       # MCP client + tool exposure
  utils/printTree.ts # Directory tree printer
.aicode/config.json   # Optional project config
```

## Troubleshooting

- Missing API key: set `OPENROUTER_API_KEY` before launch
- Provider/model errors: try a different `--model` or remove `--provider`
- MCP tool call fails: verify the server command works outside the app
- No output to file: ensure `--log-file` path is writable; directories are created automatically
- Colors look odd: your terminal must support ANSI colors (Chalk)
