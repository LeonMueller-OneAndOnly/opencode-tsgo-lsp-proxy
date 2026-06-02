import type { JsonRpcMessage } from "./types.js"

type ParserOptions = {
  onMessage: (message: JsonRpcMessage) => void
  onInvalidPayload?: (payload: string) => void
  onInvalidFrame?: (headerText: string) => void
}

export const encodeMessage = (message: JsonRpcMessage): string => {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
}

export const createMessageParser = ({
  onMessage,
  onInvalidPayload,
  onInvalidFrame,
}: ParserOptions) => {
  let buffer = Buffer.alloc(0)

  return (chunk: Buffer | string) => {
    const normalizedChunk = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
    buffer = Buffer.concat([buffer, normalizedChunk])

    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return

      const headerText = buffer.slice(0, headerEnd).toString("utf8")
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText)
      if (!lengthMatch) {
        onInvalidFrame?.(headerText)
        buffer = buffer.slice(headerEnd + 4)
        continue
      }

      const bodyLength = Number(lengthMatch[1])
      const bodyStart = headerEnd + 4
      if (buffer.length < bodyStart + bodyLength) return

      const payload = buffer.slice(bodyStart, bodyStart + bodyLength).toString("utf8")
      buffer = buffer.slice(bodyStart + bodyLength)

      const parseResult = parseJsonRpcMessage(payload)
      if (!parseResult.success) {
        onInvalidPayload?.(payload)
        continue
      }

      onMessage(parseResult.data)
    }
  }
}

const parseJsonRpcMessage = (
  payload: string
): { success: true; data: JsonRpcMessage } | { success: false } => {
  try {
    return { success: true, data: JSON.parse(payload) as JsonRpcMessage }
  } catch {
    return { success: false }
  }
}
