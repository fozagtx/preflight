import { getSplunkMcpConfig } from './config'

interface JsonRpcResponse<T> {
  jsonrpc: '2.0'
  id: string
  result?: T
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

interface McpContentPart {
  type: string
  text?: string
}

interface McpToolResult {
  content?: McpContentPart[]
  structuredContent?: unknown
  isError?: boolean
}

export interface SplunkSearchOptions {
  earliestTime?: string
  latestTime?: string
  maxCount?: number
}

export type SplunkRow = Record<string, unknown>

function parseStreamablePayload(raw: string): unknown {
  const trimmed = raw.trim()

  if (!trimmed) {
    throw new Error('Splunk MCP returned an empty response')
  }

  if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const dataLines = trimmed
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean)

    if (dataLines.length === 0) {
      throw new Error('Splunk MCP stream response contained no data payload')
    }

    return JSON.parse(dataLines[dataLines.length - 1])
  }

  return JSON.parse(trimmed)
}

function parseToolText(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return ''

  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function extractToolData(result: McpToolResult): unknown {
  if (result.structuredContent) return result.structuredContent

  const textPart = result.content?.find(part => part.type === 'text' && part.text)
  if (textPart?.text) return parseToolText(textPart.text)

  return result
}

function coerceRows(value: unknown): SplunkRow[] {
  if (Array.isArray(value)) {
    return value.filter(item => item && typeof item === 'object') as SplunkRow[]
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const candidate = record.results ?? record.rows ?? record.data ?? record.events
    if (Array.isArray(candidate)) {
      return candidate.filter(item => item && typeof item === 'object') as SplunkRow[]
    }
  }

  return []
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return AbortSignal.timeout(timeoutMs)
  }

  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

export async function callSplunkTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const config = getSplunkMcpConfig()
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  let response: Response

  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': config.protocolVersion,
        'User-Agent': `${config.clientName}/${config.clientVersion}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        },
      }),
      cache: 'no-store',
      signal: timeoutSignal(config.timeoutMs),
    })
  } catch (error) {
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
      throw new Error(`Splunk MCP ${name} timed out after ${config.timeoutMs}ms.`)
    }

    throw error
  }

  const raw = await response.text()

  if (!response.ok) {
    throw new Error(`Splunk MCP ${name} failed with ${response.status}: ${raw}`)
  }

  const payload = parseStreamablePayload(raw) as JsonRpcResponse<McpToolResult>

  if (payload.error) {
    throw new Error(`Splunk MCP ${name} error: ${payload.error.message}`)
  }

  if (!payload.result) {
    throw new Error(`Splunk MCP ${name} returned no result`)
  }

  if (payload.result.isError) {
    throw new Error(`Splunk MCP ${name} reported a tool error`)
  }

  return extractToolData(payload.result) as T
}

export async function runSplunkQuery(
  query: string,
  options: SplunkSearchOptions = {}
): Promise<SplunkRow[]> {
  const data = await callSplunkTool('splunk_run_query', {
    query,
    earliest_time: options.earliestTime,
    latest_time: options.latestTime,
    row_limit: options.maxCount,
  })

  return coerceRows(data)
}

export async function askSplunkAi(prompt: string, context: Record<string, unknown>): Promise<string> {
  const config = getSplunkMcpConfig()
  const data = await callSplunkTool(config.aiTool, {
    question: prompt,
    prompt,
    context,
  })

  if (typeof data === 'string') return data

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const answer = record.answer ?? record.response ?? record.text ?? record.summary
    if (typeof answer === 'string') return answer
  }

  return JSON.stringify(data)
}
