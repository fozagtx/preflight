export class SplunkConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SplunkConfigError'
  }
}

export interface SplunkMcpConfig {
  url: string
  token: string
  protocolVersion: string
  timeoutMs: number
  clientName: string
  clientVersion: string
  aiTool: string
  requireAi: boolean
}

export interface SplunkHecConfig {
  url: string
  token: string
  timeoutMs: number
  allowSelfSigned: boolean
  channel?: string
  index?: string
  source?: string
  sourcetype?: string
  host?: string
}

type EnvRecord = Record<string, string | undefined>

function optionalEnv(env: EnvRecord, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

function requireEnv(env: EnvRecord, names: readonly string[]): string {
  for (const name of names) {
    const value = optionalEnv(env, name)

    if (value) {
      return value
    }
  }

  throw new SplunkConfigError(
    `Missing required environment variable ${names.join(' or ')}. Set one in .env.local or the deployment environment.`,
  )
}

function optionalPositiveInteger(env: EnvRecord, name: string, defaultValue: number): number {
  const value = optionalEnv(env, name)

  if (!value) {
    return defaultValue
  }

  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new SplunkConfigError(`${name} must be a positive integer number of milliseconds.`)
  }

  return parsed
}

function optionalBoolean(env: EnvRecord, name: string, defaultValue: boolean): boolean {
  const value = optionalEnv(env, name)

  if (!value) {
    return defaultValue
  }

  const normalized = value.toLowerCase()

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  throw new SplunkConfigError(`${name} must be true or false.`)
}

function requireHttpUrl(env: EnvRecord, name: string): string {
  const rawUrl = requireEnv(env, [name])
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new SplunkConfigError(`${name} must be a valid absolute HTTP or HTTPS URL.`)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SplunkConfigError(`${name} must use http:// or https://.`)
  }

  return url.toString()
}

export function requireSplunkMcpAiToolFromEnv(env: EnvRecord = process.env): string {
  const tool = optionalEnv(env, 'SPLUNK_MCP_AI_TOOL') ?? optionalEnv(env, 'RELEASE_PREFLIGHT_AI_TOOL')

  if (!tool) {
    throw new SplunkConfigError(
      'Missing required environment variable SPLUNK_MCP_AI_TOOL or RELEASE_PREFLIGHT_AI_TOOL for Splunk AI tool calls.',
    )
  }

  return tool
}

export function getSplunkMcpConfig(env: EnvRecord = process.env): SplunkMcpConfig {
  return {
    url: requireHttpUrl(env, 'SPLUNK_MCP_URL'),
    token: requireEnv(env, ['SPLUNK_MCP_AUTH_TOKEN', 'SPLUNK_MCP_TOKEN']),
    protocolVersion: optionalEnv(env, 'SPLUNK_MCP_PROTOCOL_VERSION') ?? '2025-11-25',
    timeoutMs: optionalPositiveInteger(env, 'SPLUNK_MCP_TIMEOUT_MS', 30000),
    clientName: optionalEnv(env, 'SPLUNK_MCP_CLIENT_NAME') ?? 'splunk-typescript-client',
    clientVersion: optionalEnv(env, 'SPLUNK_MCP_CLIENT_VERSION') ?? '0.1.0',
    aiTool:
      optionalEnv(env, 'SPLUNK_MCP_AI_TOOL') ??
      optionalEnv(env, 'RELEASE_PREFLIGHT_AI_TOOL') ??
      'saia_ask_splunk_question',
    requireAi: optionalBoolean(env, 'RELEASE_PREFLIGHT_REQUIRE_AI', false),
  }
}

export function getSplunkHecConfig(env: EnvRecord = process.env): SplunkHecConfig {
  return {
    url: requireHttpUrl(env, 'SPLUNK_HEC_URL'),
    token: requireEnv(env, ['SPLUNK_HEC_TOKEN']),
    timeoutMs: optionalPositiveInteger(env, 'SPLUNK_HEC_TIMEOUT_MS', 30000),
    allowSelfSigned: optionalBoolean(env, 'SPLUNK_HEC_ALLOW_SELF_SIGNED', false),
    channel: optionalEnv(env, 'SPLUNK_HEC_CHANNEL'),
    index: optionalEnv(env, 'SPLUNK_HEC_INDEX'),
    source: optionalEnv(env, 'SPLUNK_HEC_SOURCE') ?? 'release-preflight',
    sourcetype: optionalEnv(env, 'SPLUNK_HEC_SOURCETYPE') ?? 'release_preflight:deployment',
    host: optionalEnv(env, 'SPLUNK_HEC_HOST'),
  }
}
