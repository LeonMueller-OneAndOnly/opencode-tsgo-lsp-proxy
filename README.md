# opencode tsgo LSP proxy

Point your agent to this repo and ask it to review the code for security issues. If it looks harmless, have it install the template into your codebase.

Copy-paste prompt for your agent:

```text
Please review https://github.com/LeonMueller-OneAndOnly/opencode-tsgo-lsp-proxy for security issues. If the code looks harmless, install the template into this codebase and update opencode.json accordingly. After changing opencode.json, remind me to restart opencode.
```

Small stdio proxy template for using `tsgo --lsp --stdio` as the TypeScript LSP in opencode.

The copyable files are in `template/`. This repository is meant to be cloned into a temporary location by an agent, reviewed, and then copied into the target project.

## Why

Using `tsgo --lsp --stdio` directly in opencode can fail or keep hanging on diagnostics. This proxy starts `tsgo`, forwards LSP messages over stdio, restarts the child if it crashes, and replays the initialize/open-document state after a restart.

It intentionally does not create extra `textDocument/diagnostic` requests. opencode may still request diagnostics itself after edits.

## Install

From your project root:

```sh
tmpdir="$(mktemp -d)"
git clone https://github.com/LeonMueller-OneAndOnly/opencode-tsgo-lsp-proxy "$tmpdir/opencode-tsgo-lsp-proxy"
mkdir -p scripts/opencode-tsgo-lsp-proxy
cp -R "$tmpdir/opencode-tsgo-lsp-proxy/template/"* scripts/opencode-tsgo-lsp-proxy/
```

Before editing `opencode.json`, the installing agent should check the target project's runtime. Use `node` if the installed Node.js version can execute TypeScript syntax directly. If not, use the project's existing TypeScript runner, for example `tsx`, `bun`, or another already-approved runtime, and adjust the command below accordingly.

## opencode.json

Add or update the TypeScript LSP entry:

```json
{
  "lsp": {
    "typescript": {
      "command": ["node", "scripts/opencode-tsgo-lsp-proxy/index.ts"],
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
      "command": ["node", "scripts/opencode-tsgo-lsp-proxy/index.ts"],
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

- `template/index.ts`: executable opencode LSP command to copy into your project.
- `template/controller.ts`: restart/replay logic.
- `template/parser.ts`: minimal LSP content-length frame parser.
- `template/types.ts`: JSON-RPC and child-process types.
