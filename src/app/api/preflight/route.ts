import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'

import { askSplunkAi, runSplunkQuery } from '@/lib/splunk/mcp'
import { getSplunkMcpConfig } from '@/lib/splunk/config'
import { buildPreflightReport } from '@/lib/preflight/report'
import {
  preflightRequestSchema,
  type PreflightRequest,
} from '@/lib/preflight/schema'
import {
  buildErrorsSpl,
  buildRecentSpl,
  buildSummarySpl,
} from '@/lib/preflight/spl'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  let preflightRequest: PreflightRequest

  try {
    preflightRequest = preflightRequestSchema.parse(await request.json())
  } catch (error) {
    return validationResponse(error)
  }

  const summarySpl = buildSummarySpl(preflightRequest)
  const errorsSpl = buildErrorsSpl(preflightRequest)
  const recentSpl = buildRecentSpl(preflightRequest)

  try {
    const mcpConfig = getSplunkMcpConfig()
    const [summaryRows, errorRows, recentRows] = await Promise.all([
      runSplunkQuery(summarySpl, { maxCount: 1 }),
      runSplunkQuery(errorsSpl, { maxCount: 8 }),
      runSplunkQuery(recentSpl, { maxCount: 12 }),
    ])

    const aiContext = {
      request: preflightRequest,
      summaryRows,
      errorRows,
      recentRows,
      spl: {
        summary: summarySpl,
        errors: errorsSpl,
        recent: recentSpl,
      },
    }
    let aiNarrative: string

    try {
      aiNarrative = await askSplunkAi(buildNarrativePrompt(preflightRequest), aiContext)
    } catch (error) {
      if (mcpConfig.requireAi) {
        throw error
      }

      aiNarrative = buildDeterministicNarrative(summaryRows, errorRows, recentRows)
    }

    const report = buildPreflightReport({
      request: preflightRequest,
      summaryRows,
      errorRows,
      recentRows,
      aiNarrative,
      spl: {
        summary: summarySpl,
        errors: errorsSpl,
        recent: recentSpl,
      },
    })

    return NextResponse.json({
      report,
      _meta: {
        source: 'splunk-mcp',
        releaseId: preflightRequest.releaseId,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Release Preflight analysis failed:', error)
    return upstreamResponse('Release Preflight analysis failed', error)
  }
}

function buildNarrativePrompt(request: PreflightRequest) {
  return [
    'You are Release Preflight, a Splunk release-risk agent.',
    'Use only the supplied Splunk query results.',
    'Give a terse release decision: ship, canary, hold, or rollback-ready.',
    'Name the strongest evidence and first action.',
    `Service: ${request.service}.`,
    `Environment: ${request.environment}.`,
    `Release: ${request.releaseId}.`,
    `Lookback minutes: ${request.lookbackMinutes}.`,
  ].join(' ')
}

function buildDeterministicNarrative(
  summaryRows: Record<string, unknown>[],
  errorRows: Record<string, unknown>[],
  recentRows: Record<string, unknown>[]
) {
  const summary = summaryRows[0] || {}
  const totalEvents = String(summary.total_events ?? 0)
  const errorEvents = String(summary.error_events ?? 0)
  const failureSignals = String(summary.failure_signals ?? 0)
  const affectedHosts = String(summary.affected_hosts ?? 0)
  const strongestError = errorRows[0]
  const latestEvent = recentRows[0]

  if (strongestError) {
    return [
      'Splunk AI narrative was not available; using deterministic Splunk MCP evidence.',
      `Decision: canary or hold depending on release criticality.`,
      `Evidence: ${totalEvents} events, ${errorEvents} errors, ${failureSignals} failure-language signals, ${affectedHosts} affected host(s).`,
      `Strongest signal: ${String(strongestError.latest_message ?? strongestError.raw_text ?? 'No message field returned')}.`,
    ].join(' ')
  }

  return [
    'Splunk AI narrative was not available; using deterministic Splunk MCP evidence.',
    `Decision: canary with close observation.`,
    `Evidence: ${totalEvents} events, ${errorEvents} errors, ${failureSignals} failure-language signals, ${affectedHosts} affected host(s).`,
    latestEvent
      ? `Latest event: ${String(latestEvent.raw_text ?? latestEvent.message ?? 'No message field returned')}.`
      : 'No matching event rows were returned; treat that as an observability gap.',
  ].join(' ')
}

function validationResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Invalid Release Preflight analysis request.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { error: 'Request body must be valid JSON.' },
    { status: 400 }
  )
}

function upstreamResponse(message: string, error: unknown) {
  return NextResponse.json(
    {
      error: message,
      detail: getErrorMessage(error),
    },
    { status: 502 }
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown upstream failure.'
}
