import { NextRequest, NextResponse } from 'next/server'
import { z, ZodError } from 'zod'

import { deploymentEventSchema } from '@/lib/preflight/schema'
import { sendDeploymentEvent } from '@/lib/splunk/hec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const deploymentIngestSchema = z.union([
  deploymentEventSchema.transform((event) => [event]),
  z
    .object({ event: deploymentEventSchema })
    .strict()
    .transform(({ event }) => [event]),
  z
    .object({
      events: z.array(deploymentEventSchema).min(1).max(500),
    })
    .strict()
    .transform(({ events }) => events),
])

export async function POST(request: NextRequest) {
  let events: z.infer<typeof deploymentIngestSchema>

  try {
    events = deploymentIngestSchema.parse(await request.json())
  } catch (error) {
    return validationResponse(error)
  }

  try {
    const receipts = await Promise.all(events.map(sendDeploymentEvent))

    return NextResponse.json(
      {
        accepted: events.length,
        receipts,
        _meta: {
          source: 'splunk-hec',
          ingestedAt: new Date().toISOString(),
        },
      },
      { status: 202 }
    )
  } catch (error) {
    console.error('Splunk HEC ingestion failed:', error)
    return upstreamResponse('Splunk HEC ingestion failed', error)
  }
}

function validationResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Invalid deployment event request.',
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
