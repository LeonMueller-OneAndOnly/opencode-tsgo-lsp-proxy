# opencode tsgo LSP proxy

Point your agent to this repo and tell it to check security issues and install it afterwards if it is harmless.

Small stdio proxy for using `tsgo --lsp --stdio` as the TypeScript LSP in opencode.

## Why

Some opencode setups fail or become fragile when launching `tsgo --lsp --stdio` directly. This proxy starts `tsgo`, forwards LSP messages over stdio, restarts the child if it crashes, and replays the initialize/open-document state after a restart.

It intentionally does not create extra `textDocument/diagnostic` requests. opencode may still request diagnostics itself after edits.

## Install

From your project root:

```sh
mkdir -p scripts/opencode-tsgo-lsp-proxy
curl -L https://github.com/LeonMueller-OneAndOnly/opencode-tsgo-lsp-proxy/archive/refs/heads/main.tar.gz \
  | tar -xz --strip-components=1 -C scripts/opencode-tsgo-lsp-proxy
pnpm add -D tsx
```

If your project does not use `pnpm`, install `tsx` with your package manager, or use `npx tsx` in the config below.

## opencode.json

Add or update the TypeScript LSP entry:

```json
{
  "lsp": {
    "typescript": {
      "command": ["npx", "tsx", "scripts/opencode-tsgo-lsp-proxy/index.ts"],
      "extensions": [".cjs", ".mjs", ".js", ".jsx", ".ts", ".tsx", ".mts", ".cts"]
    }
  }
}
```

Restart opencode after editing `opencode.json`; opencode does not reload LSP config in already-running sessions.

## Options

By default the proxy runs the local `node_modules/.bin/tsgo` if present, otherwise `tsgo` from `PATH`.

Override the child command:

```json
{
  "lsp": {
    "typescript": {
      "command": ["npx", "tsx", "scripts/opencode-tsgo-lsp-proxy/index.ts"],
      "env": {
        "OPENCODE_TSGO_COMMAND": "./node_modules/.bin/tsgo --lsp --stdio"
      },
      "extensions": [".cjs", ".mjs", ".js", ".jsx", ".ts", ".tsx", ".mts", ".cts"]
    }
  }
}
```

Enable debug logs:

```json
{
  "env": {
    "OPENCODE_TSGO_DEBUG": "1"
  }
}
```

## Files

- `index.ts`: executable opencode LSP command.
- `controller.ts`: restart/replay logic.
- `parser.ts`: minimal LSP content-length frame parser.
- `types.ts`: JSON-RPC and child-process types.
