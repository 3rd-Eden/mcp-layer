# REST Benchmark Harness

This folder contains a lightweight load-test harness for `@mcp-layer/rest`. It starts the shared MCP test server in-process, registers the REST plugin, and uses `autocannon` to drive load against a single REST tool endpoint.

## Table of Contents

- [Quick Start](#quick-start)
- [Common Scenarios](#common-scenarios)

## Quick Start

```sh
pnpm --filter @mcp-layer/rest run benchmark:load
```

## Common Scenarios

Target a higher connection count:

```sh
pnpm --filter @mcp-layer/rest run benchmark:load -- --connections 1000 --duration 20
```

Exercise multiple MCP sessions:

```sh
pnpm --filter @mcp-layer/rest run benchmark:load -- --sessions 4 --target 2
```

Run server/client separately (avoids load generator sharing the REST process):

```sh
node packages/rest/benchmark/server.js --mode direct --transport stdio --sessions 1 --host 127.0.0.1 --port 0
node packages/rest/benchmark/client.js --url http://127.0.0.1:PORT/v0/echo --connections 500 --duration 10
```

Run a slower tool with a custom payload:

```sh
pnpm --filter @mcp-layer/rest run benchmark:load -- --tool progress --payload '{"steps":3,"delayMs":20}'
```

Notes:
- `--sessions` registers multiple MCP sessions, but each REST route is still tied to a specific session. There is no load balancing across sessions today.
- `--target` chooses which session index or name to hit when multiple sessions are registered (default: `0`).
- Use `--mode manager` to benchmark the manager (true proxy) path.
- Use `--transport stdio` to spawn real MCP server processes instead of in-process sessions.

<details>
<summary>All CLI options</summary>

Available flags:
- `--connections` (default: 100)
- `--duration` (seconds, default: 10)
- `--pipelining` (default: 1)
- `--sessions` (default: 1)
- `--timeout` (seconds, default: 10)
- `--host` (default: 127.0.0.1)
- `--port` (default: 0, choose a random open port)
- `--tool` (default: echo)
- `--text` (default: hello)
- `--loud` or `--no-loud`
- `--target` (default: 0)
- `--method` (default: POST)
- `--mode` (default: direct)
- `--transport` (default: memory)
- `--payload` (default: empty; when set must be JSON)
- `--url` (default: empty; required for client mode)
- `--auth-mode` (default: optional)
- `--auth-scheme` (default: bearer)
- `--auth-header` (default: authorization)
- `--identities` (default: 1)

</details>

## License

MIT
