#!/usr/bin/env node

import fs from "fs"
import path from "path"
import { spawn } from "child_process"

import { createProxyController } from "./controller.js"
import { createMessageParser, encodeMessage } from "./parser.js"

import type { ChildProcessFactory, JsonRpcMessage, Logger } from "./types.js"

type CommandConfig = {
  command: string
  args: string[]
}

const DEFAULT_TSGO_ARGS = ["--lsp", "--stdio"] as const
const LOG_PREFIX = "[opencode-tsgo-proxy]"

const parseCommand = (rawCommand: string): { command: string; args: string[] } => {
  const parts = [...rawCommand.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((part): part is string => typeof part === "string" && part.length > 0)

  if (parts.length === 0) {
    throw new Error("OPENCODE_TSGO_COMMAND must not be empty")
  }

  const [command, ...args] = parts
  if (!command) {
    throw new Error("OPENCODE_TSGO_COMMAND must include a command")
  }
  return { command, args }
}

const resolveTsgoCommand = (): CommandConfig => {
  const customCommand = process.env.OPENCODE_TSGO_COMMAND
  if (customCommand) {
    return parseCommand(customCommand)
  }

  const localTsgoBin = path.resolve(process.cwd(), "node_modules/.bin/tsgo")
  const command = fs.existsSync(localTsgoBin) ? localTsgoBin : "tsgo"
  return {
    command,
    args: [...DEFAULT_TSGO_ARGS],
  }
}

const debugEnabled = process.env.OPENCODE_TSGO_DEBUG === "1"

const writeLog = (level: keyof Logger, message: string, details?: Record<string, unknown>) => {
  if (!debugEnabled) return

  const serializedDetails = details ? ` ${JSON.stringify(details)}` : ""
  process.stderr.write(`${LOG_PREFIX} ${level} ${message}${serializedDetails}\n`)
}

const logger: Logger = {
  debug: (message, details) => writeLog("debug", message, details),
  info: (message, details) => writeLog("info", message, details),
  warn: (message, details) => writeLog("warn", message, details),
}

const childFactory: ChildProcessFactory = () => {
  const { command, args } = resolveTsgoCommand()
  logger.info("spawning child", { command, args })
  return spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  })
}

const controller = createProxyController({
  createChild: childFactory,
  sendToClient: (message: JsonRpcMessage) => {
    process.stdout.write(encodeMessage(message))
  },
  writeToClientStderr: (chunk) => {
    process.stderr.write(chunk)
  },
  logger,
  onCrashLoopSuppressed: () => {
    shutdown(1)
  },
  clock: {
    now: () => Date.now(),
  },
  generateRequestId: (() => {
    let nextRequestId = 900_000_000
    return () => {
      nextRequestId += 1
      return nextRequestId
    }
  })(),
})

const clientParser = createMessageParser({
  onMessage: (message) => {
    controller.handleClientMessage(message)
  },
  onInvalidFrame: (headerText) => {
    logger.warn("invalid client frame", { headerText })
  },
  onInvalidPayload: () => {
    logger.warn("invalid client payload")
  },
})

controller.start()
process.stdin.on("data", clientParser)

let stopped = false

const stopController = () => {
  if (stopped) return
  stopped = true
  controller.stop()
}

const shutdown = (exitCode: number) => {
  stopController()
  process.exit(exitCode)
}

process.stdin.on("end", () => shutdown(0))
process.stdin.on("close", () => shutdown(0))
process.on("exit", () => stopController())
process.on("SIGINT", () => shutdown(130))
process.on("SIGTERM", () => shutdown(143))
