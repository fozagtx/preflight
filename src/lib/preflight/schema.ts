import { z } from 'zod'

const requiredText = (message: string) => z.string().trim().min(1, message)
const optionalText = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional()
)

export const preflightRequestSchema = z.object({
  service: requiredText('Service name is required'),
  environment: requiredText('Environment name is required'),
  releaseId: requiredText('Release or version ID is required'),
  repository: optionalText,
  branch: optionalText,
  commitSha: optionalText,
  lookbackMinutes: z.coerce.number().int().min(5).max(10080).default(240),
})

export const deploymentEventSchema = z.object({
  service: requiredText('Service name is required'),
  environment: requiredText('Environment name is required'),
  releaseId: requiredText('Release or version ID is required'),
  repository: optionalText,
  branch: optionalText,
  commitSha: optionalText,
  actor: optionalText,
  changeSummary: optionalText,
})

export const evidenceEventSchema = z.object({
  time: z.string(),
  severity: z.enum(['normal', 'warn', 'danger']),
  title: z.string(),
  detail: z.string(),
  source: z.string().optional(),
})

export const remediationSchema = z.object({
  title: z.string(),
  command: z.string().optional(),
  reason: z.string(),
})

export const preflightReportSchema = z.object({
  service: z.string(),
  environment: z.string(),
  releaseId: z.string(),
  riskScore: z.number().min(0).max(100),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  summary: z.string(),
  aiNarrative: z.string(),
  metrics: z.object({
    totalEvents: z.number(),
    errorEvents: z.number(),
    failureSignals: z.number(),
    affectedHosts: z.number(),
  }),
  evidence: z.array(evidenceEventSchema),
  remediations: z.array(remediationSchema),
  spl: z.object({
    summary: z.string(),
    errors: z.string(),
    recent: z.string(),
  }),
})

export type PreflightRequest = z.infer<typeof preflightRequestSchema>
export type DeploymentEvent = z.infer<typeof deploymentEventSchema>
export type EvidenceEvent = z.infer<typeof evidenceEventSchema>
export type PreflightReport = z.infer<typeof preflightReportSchema>
