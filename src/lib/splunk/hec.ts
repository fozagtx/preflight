import http from 'node:http'
import https from 'node:https'

import { getSplunkHecConfig } from './config'

export interface DeploymentEventInput {
  service: string
  environment: string
  releaseId: string
  repository?: string
  branch?: string
  commitSha?: string
  actor?: string
  changeSummary?: string
}

export interface HecResponse {
  text: string
  code: number
  ackId?: number
  'invalid-event-number'?: number
  invalidEventNumber?: number
}

interface RawHttpResponse {
  ok: boolean
  status: number
  body: string
}

function buildHecEndpoint(url: string): string {
  const trimmed = url.replace(/\/+$/, '')
  if (trimmed.endsWith('/services/collector/event')) return trimmed
  if (trimmed.endsWith('/services/collector')) return `${trimmed}/event`
  return `${trimmed}/services/collector/event`
}

export async function sendDeploymentEvent(event: DeploymentEventInput): Promise<HecResponse> {
  const config = getSplunkHecConfig()
  const endpoint = buildHecEndpoint(config.url)
  const headers: Record<string, string> = {
    Authorization: `Splunk ${config.token}`,
    'Content-Type': 'application/json',
  }

  if (config.channel) {
    headers['X-Splunk-Request-Channel'] = config.channel
  }

  const payload = JSON.stringify({
    time: Math.floor(Date.now() / 1000),
    source: config.source,
    sourcetype: config.sourcetype,
    index: config.index,
    host: config.host,
    event: {
      event_type: 'deployment',
      service: event.service,
      environment: event.environment,
      release_id: event.releaseId,
      repository: event.repository,
      branch: event.branch,
      commit_sha: event.commitSha,
      actor: event.actor,
      change_summary: event.changeSummary,
    },
  })
  const response = await postJson(endpoint, headers, payload, {
    allowSelfSigned: config.allowSelfSigned,
    timeoutMs: config.timeoutMs,
  })

  if (!response.ok) {
    throw new Error(`Splunk HEC ingest failed with ${response.status}: ${response.body}`)
  }

  const parsed = JSON.parse(response.body) as HecResponse

  if (parsed.code !== 0) {
    const invalidEventNumber = parsed.invalidEventNumber ?? parsed['invalid-event-number']
    throw new Error(
      `Splunk HEC rejected the event with code ${parsed.code}: ${parsed.text}${
        invalidEventNumber !== undefined ? ` (invalid event ${invalidEventNumber})` : ''
      }`
    )
  }

  return parsed
}

function postJson(
  endpoint: string,
  headers: Record<string, string>,
  payload: string,
  options: { allowSelfSigned: boolean; timeoutMs: number }
): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const isHttps = url.protocol === 'https:'
    const transport = isHttps ? https : http
    const requestOptions: http.RequestOptions & https.RequestOptions = {
      method: 'POST',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: options.timeoutMs,
    }

    if (isHttps && options.allowSelfSigned) {
      requestOptions.rejectUnauthorized = false
    }

    const request = transport.request(requestOptions, (response) => {
      const chunks: Buffer[] = []

      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })

      response.on('end', () => {
        const status = response.statusCode ?? 0

        resolve({
          ok: status >= 200 && status < 300,
          status,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })

    request.on('timeout', () => {
      request.destroy(new Error(`Splunk HEC ingest timed out after ${options.timeoutMs}ms.`))
    })

    request.on('error', reject)
    request.write(payload)
    request.end()
  })
}
