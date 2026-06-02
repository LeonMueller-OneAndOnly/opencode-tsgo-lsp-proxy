import type { EventEmitter } from "events"

export type JsonRpcId = number | string

export type JsonRpcErrorObject = {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcRequest<TParams = unknown> = {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: string
  params?: TParams
}

export type JsonRpcNotification<TParams = unknown> = {
  jsonrpc: "2.0"
  method: string
  params?: TParams
}

export type JsonRpcSuccessResponse<TResult = unknown> = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result: TResult
}

export type JsonRpcErrorResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId | null
  error: JsonRpcErrorObject
}

export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse

export type JsonRpcMessage<TResult = unknown, TParams = unknown> =
  | JsonRpcRequest<TParams>
  | JsonRpcNotification<TParams>
  | JsonRpcResponse<TResult>

export type ChildStdin = {
  write: (chunk: string | Buffer) => boolean
}

export type ChildReadable = EventEmitter & {
  on(event: "data", listener: (chunk: Buffer | string) => void): ChildReadable
  off(event: "data", listener: (chunk: Buffer | string) => void): ChildReadable
}

export type ChildExitEvents = EventEmitter & {
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): ChildExitEvents
  off(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): ChildExitEvents
}

export type ChildProcessAdapter = ChildExitEvents & {
  stdin: ChildStdin
  stdout: ChildReadable
  stderr: ChildReadable
  killed: boolean
  kill: (signal?: NodeJS.Signals) => boolean
}

export type ChildProcessFactory = () => ChildProcessAdapter

export type Logger = {
  debug: (message: string, details?: Record<string, unknown>) => void
  info: (message: string, details?: Record<string, unknown>) => void
  warn: (message: string, details?: Record<string, unknown>) => void
}

export type Clock = {
  now: () => number
}

export type ProxyState = {
  childGeneration: number
  serverReady: boolean
  restartCountInWindow: number
  crashLoopSuppressed: boolean
  lastServerActivityAtMs: number | null
  openDocumentCount: number
}
