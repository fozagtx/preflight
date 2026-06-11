import { z } from 'zod'

export type {
  DeploymentEvent,
  EvidenceEvent,
  PreflightReport,
  PreflightRequest,
} from '@/lib/preflight/schema'

export type Screen = 'ready' | 'analyzing' | 'report'
export type StatusType = 'READY' | 'RUNNING' | 'HOLD' | 'CANARY' | 'SHIP'

const nonEmptyString = z.string().trim().min(1)

export const splunkPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

export const splunkFieldValueSchema = z.union([
  splunkPrimitiveSchema,
  z.array(splunkPrimitiveSchema),
])

export const splunkTimeSchema = z.union([nonEmptyString, z.number()])

export const splunkIndexKindSchema = z.enum([
  'events',
  'metrics',
  'traces',
  'audit',
  'summary',
])

export const splunkRetentionPolicySchema = z
  .object({
    frozenTimePeriodInSecs: z.number().int().nonnegative().optional(),
    maxDataSize: nonEmptyString.optional(),
    maxTotalDataSizeMB: z.number().int().positive().optional(),
  })
  .strict()

export const splunkIndexSchema = z
  .object({
    name: nonEmptyString,
    kind: splunkIndexKindSchema.optional(),
    app: nonEmptyString.optional(),
    owner: nonEmptyString.optional(),
    environment: nonEmptyString.optional(),
    sourcetypes: z.array(nonEmptyString).optional(),
    retention: splunkRetentionPolicySchema.optional(),
    searchHead: z.string().url().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const splunkSearchMetadataSchema = z
  .object({
    searchId: nonEmptyString.optional(),
    queryName: nonEmptyString.optional(),
    search: nonEmptyString.optional(),
    app: nonEmptyString.optional(),
    owner: nonEmptyString.optional(),
    earliestTime: nonEmptyString.optional(),
    latestTime: nonEmptyString.optional(),
    dispatchState: nonEmptyString.optional(),
    runDurationSeconds: z.number().nonnegative().optional(),
    scannedEvents: z.number().int().nonnegative().optional(),
    resultCount: z.number().int().nonnegative().optional(),
    indexes: z.array(splunkIndexSchema).optional(),
    fields: z.array(nonEmptyString).optional(),
    warnings: z.array(nonEmptyString).optional(),
  })
  .catchall(z.unknown())

export const splunkQueryRowSchema = z
  .object({
    _time: splunkTimeSchema.optional(),
    index: nonEmptyString.optional(),
    source: nonEmptyString.optional(),
    sourcetype: nonEmptyString.optional(),
    host: nonEmptyString.optional(),
  })
  .catchall(splunkFieldValueSchema)

export const splunkQueryResultSchema = z
  .object({
    metadata: splunkSearchMetadataSchema,
    rows: z.array(splunkQueryRowSchema),
  })
  .strict()

export const splunkHecIngestResponseSchema = z
  .object({
    text: nonEmptyString,
    code: z.number().int(),
    ackId: z.number().int().nonnegative().optional(),
    'invalid-event-number': z.number().int().nonnegative().optional(),
  })
  .catchall(splunkFieldValueSchema)

export const preflightRiskCategorySchema = z.enum([
  'reliability',
  'performance',
  'security',
  'capacity',
  'change',
  'data_quality',
  'observability',
])

export const preflightSeveritySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
])

export const preflightRiskLevelSchema = z.enum([
  'low',
  'moderate',
  'high',
  'critical',
])

export const releaseMetadataSchema = z
  .object({
    releaseId: nonEmptyString,
    service: nonEmptyString,
    environment: nonEmptyString,
    version: nonEmptyString.optional(),
    commitSha: nonEmptyString.optional(),
    buildId: nonEmptyString.optional(),
    deployedBy: nonEmptyString.optional(),
  })
  .catchall(z.unknown())

export const preflightEvidenceSchema = z
  .object({
    queryName: nonEmptyString.optional(),
    searchId: nonEmptyString.optional(),
    rowIndex: z.number().int().nonnegative(),
    index: nonEmptyString.optional(),
    source: nonEmptyString.optional(),
    sourcetype: nonEmptyString.optional(),
    host: nonEmptyString.optional(),
    time: splunkTimeSchema.optional(),
    fields: z.record(z.string(), splunkFieldValueSchema),
  })
  .strict()

export const preflightRiskSignalSchema = z
  .object({
    id: nonEmptyString,
    category: preflightRiskCategorySchema,
    severity: preflightSeveritySchema,
    score: z.number().min(0).max(100),
    title: nonEmptyString,
    description: nonEmptyString,
    metrics: z.record(z.string(), z.number()),
    evidence: z.array(preflightEvidenceSchema).min(1),
    remediationActionIds: z.array(nonEmptyString),
  })
  .strict()

export const preflightReplayEventTypeSchema = z.enum([
  'observation',
  'threshold_breach',
  'correlation',
  'risk_projection',
  'remediation',
])

export const preflightReplayEventSchema = z
  .object({
    id: nonEmptyString,
    sequence: z.number().int().positive(),
    type: preflightReplayEventTypeSchema,
    severity: preflightSeveritySchema,
    title: nonEmptyString,
    description: nonEmptyString,
    signalId: nonEmptyString,
    observedAt: splunkTimeSchema.optional(),
    evidence: z.array(preflightEvidenceSchema).min(1),
  })
  .strict()

export const remediationPrioritySchema = z.enum([
  'low',
  'medium',
  'high',
  'urgent',
])

export const remediationStatusSchema = z.enum([
  'proposed',
  'queued',
  'in_progress',
  'completed',
  'dismissed',
])

export const remediationActionSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    description: nonEmptyString,
    category: preflightRiskCategorySchema,
    priority: remediationPrioritySchema,
    status: remediationStatusSchema,
    owner: nonEmptyString.optional(),
    runbookUrl: z.string().url().optional(),
    verificationQuery: nonEmptyString.optional(),
    relatedSignalIds: z.array(nonEmptyString).min(1),
  })
  .strict()

export const preflightReportSourceSchema = z
  .object({
    rowCount: z.number().int().nonnegative(),
    searchIds: z.array(nonEmptyString),
    queryNames: z.array(nonEmptyString),
    indexes: z.array(splunkIndexSchema),
  })
  .strict()

export const preflightRiskReportSchema = z
  .object({
    reportId: nonEmptyString,
    generatedAt: nonEmptyString,
    release: releaseMetadataSchema,
    score: z.number().min(0).max(100),
    level: preflightRiskLevelSchema,
    summary: nonEmptyString,
    source: preflightReportSourceSchema,
    signals: z.array(preflightRiskSignalSchema),
    replay: z.array(preflightReplayEventSchema),
    remediationActions: z.array(remediationActionSchema),
  })
  .strict()

export const preflightRiskThresholdsSchema = z
  .object({
    warningErrorRate: z.number().min(0).max(1).optional(),
    highErrorRate: z.number().min(0).max(1).optional(),
    criticalErrorRate: z.number().min(0).max(1).optional(),
    warningErrorCount: z.number().int().nonnegative().optional(),
    highErrorCount: z.number().int().nonnegative().optional(),
    criticalErrorCount: z.number().int().nonnegative().optional(),
    highLatencyP95Ms: z.number().positive().optional(),
    criticalLatencyP95Ms: z.number().positive().optional(),
    highSaturationPercent: z.number().min(0).max(100).optional(),
    criticalSaturationPercent: z.number().min(0).max(100).optional(),
    highSecurityFindingCount: z.number().int().nonnegative().optional(),
    criticalSecurityFindingCount: z.number().int().nonnegative().optional(),
    highRollbackCount: z.number().int().nonnegative().optional(),
    criticalRollbackCount: z.number().int().nonnegative().optional(),
  })
  .strict()

export const preflightRiskReportInputSchema = z
  .object({
    generatedAt: nonEmptyString,
    release: releaseMetadataSchema,
    results: z.array(splunkQueryResultSchema).min(1),
    thresholds: preflightRiskThresholdsSchema.optional(),
  })
  .strict()

export type SplunkPrimitive = z.infer<typeof splunkPrimitiveSchema>
export type SplunkFieldValue = z.infer<typeof splunkFieldValueSchema>
export type SplunkIndex = z.infer<typeof splunkIndexSchema>
export type SplunkSearchMetadata = z.infer<typeof splunkSearchMetadataSchema>
export type SplunkQueryRow = z.infer<typeof splunkQueryRowSchema>
export type SplunkQueryResult = z.infer<typeof splunkQueryResultSchema>
export type SplunkHecIngestResponse = z.infer<typeof splunkHecIngestResponseSchema>
export type ReleaseMetadata = z.infer<typeof releaseMetadataSchema>
export type PreflightRiskCategory = z.infer<typeof preflightRiskCategorySchema>
export type PreflightSeverity = z.infer<typeof preflightSeveritySchema>
export type PreflightRiskLevel = z.infer<typeof preflightRiskLevelSchema>
export type PreflightEvidence = z.infer<typeof preflightEvidenceSchema>
export type PreflightRiskSignal = z.infer<typeof preflightRiskSignalSchema>
export type PreflightReplayEvent = z.infer<typeof preflightReplayEventSchema>
export type RemediationAction = z.infer<typeof remediationActionSchema>
export type PreflightRiskReport = z.infer<typeof preflightRiskReportSchema>
export type PreflightRiskThresholds = z.infer<typeof preflightRiskThresholdsSchema>
export type PreflightRiskReportInput = z.infer<typeof preflightRiskReportInputSchema>
