import type { SplunkRow } from '@/lib/splunk/mcp'
import {
  preflightRiskReportInputSchema,
  preflightRiskReportSchema,
  type PreflightEvidence,
  type PreflightReplayEvent,
  type PreflightRiskCategory,
  type PreflightRiskReport,
  type PreflightRiskSignal,
  type PreflightRiskThresholds,
  type PreflightSeverity,
  type ReleaseMetadata,
  type RemediationAction,
  type SplunkFieldValue,
  type SplunkIndex,
  type SplunkQueryResult,
  type SplunkQueryRow,
  type SplunkSearchMetadata,
} from '@/types'
import type { EvidenceEvent, PreflightReport, PreflightRequest } from './schema'

interface BuildReportInput {
  request: PreflightRequest
  summaryRows: SplunkRow[]
  errorRows: SplunkRow[]
  recentRows: SplunkRow[]
  aiNarrative: string
  spl: {
    summary: string
    errors: string
    recent: string
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function riskLevel(score: number): PreflightReport['riskLevel'] {
  if (score >= 80) return 'critical'
  if (score >= 60) return 'high'
  if (score >= 35) return 'medium'
  return 'low'
}

function calculateRiskScore(metrics: PreflightReport['metrics']): number {
  const eventVolumePressure = Math.min(metrics.totalEvents / 1000, 1) * 15
  const errorPressure = Math.min(metrics.errorEvents / 100, 1) * 35
  const signalPressure = Math.min(metrics.failureSignals / 100, 1) * 35
  const hostPressure = Math.min(metrics.affectedHosts / 20, 1) * 15

  return Math.round(Math.min(eventVolumePressure + errorPressure + signalPressure + hostPressure, 100))
}

function buildEvidence(errorRows: SplunkRow[], recentRows: SplunkRow[]): EvidenceEvent[] {
  const fromErrors = errorRows.slice(0, 6).map(row => ({
    time: toText(row.latest_time || row._time || 'recent'),
    severity: 'danger' as const,
    title: `${toText(row.host || 'unknown host')} emitted ${toText(row.count || 0)} risk signal(s)`,
    detail: toText(row.latest_message || row.raw_text || row._raw || 'No message returned by Splunk'),
    source: toText(row.source || row.sourcetype),
  }))

  const fromRecent = recentRows.slice(0, 4).map(row => {
    const severityText = toText(row.normalized_severity).toLowerCase()
    const severity: EvidenceEvent['severity'] =
      severityText.includes('error') || severityText.includes('fatal')
        ? 'danger'
        : severityText.includes('warn')
          ? 'warn'
          : 'normal'

    return {
      time: toText(row._time || 'recent'),
      severity,
      title: `${toText(row.host || 'unknown host')} ${severityText || 'event'}`,
      detail: toText(row.raw_text || row.message || row._raw || 'No message returned by Splunk'),
      source: toText(row.source || row.sourcetype),
    }
  })

  return [...fromErrors, ...fromRecent].slice(0, 10)
}

function buildRemediations(report: Pick<PreflightReport, 'riskScore' | 'metrics'>): PreflightReport['remediations'] {
  const remediations: PreflightReport['remediations'] = []

  if (report.riskScore >= 60) {
    remediations.push({
      title: 'Hold the release gate',
      command: 'Require human approval before production rollout',
      reason: 'Splunk evidence shows enough active failure pressure to make blind deployment unsafe.',
    })
  }

  if (report.metrics.errorEvents > 0) {
    remediations.push({
      title: 'Quarantine recurring error sources',
      command: 'Review hosts and sourcetypes in the evidence table before canary expansion',
      reason: 'Errors are already present in the lookback window for the selected service.',
    })
  }

  if (report.metrics.failureSignals > report.metrics.errorEvents) {
    remediations.push({
      title: 'Investigate hidden failure language',
      command: 'Search timeout, exception, panic, OOM, and failed patterns across related logs',
      reason: 'The raw event stream contains failure terms beyond normalized severity fields.',
    })
  }

  if (remediations.length === 0) {
    remediations.push({
      title: 'Proceed with canary, not full rollout',
      command: 'Deploy to the smallest observable cohort and rerun Release Preflight after first traffic',
      reason: 'No blocking signal was found, but Splunk should confirm production behavior before expansion.',
    })
  }

  return remediations
}

export function buildPreflightReport(input: BuildReportInput): PreflightReport {
  const summary = input.summaryRows[0] || {}
  const metrics = {
    totalEvents: toNumber(summary.total_events),
    errorEvents: toNumber(summary.error_events),
    failureSignals: toNumber(summary.failure_signals),
    affectedHosts: toNumber(summary.affected_hosts),
  }
  const riskScore = calculateRiskScore(metrics)
  const level = riskLevel(riskScore)

  return {
    service: input.request.service,
    environment: input.request.environment,
    releaseId: input.request.releaseId,
    riskScore,
    riskLevel: level,
    summary:
      metrics.totalEvents === 0
        ? 'Splunk returned no matching telemetry for this service, environment, and release window. Treat that as an observability gap, not a clean bill of health.'
        : `${metrics.totalEvents} matching events, ${metrics.errorEvents} explicit errors, ${metrics.failureSignals} failure-language signals, ${metrics.affectedHosts} affected host(s).`,
    aiNarrative: input.aiNarrative,
    metrics,
    evidence: buildEvidence(input.errorRows, input.recentRows),
    remediations: buildRemediations({ riskScore, metrics }),
    spl: input.spl,
  }
}

export const DEFAULT_PREFLIGHT_RISK_THRESHOLDS: Required<PreflightRiskThresholds> =
  Object.freeze({
    warningErrorRate: 0.02,
    highErrorRate: 0.05,
    criticalErrorRate: 0.1,
    warningErrorCount: 1,
    highErrorCount: 10,
    criticalErrorCount: 50,
    highLatencyP95Ms: 1000,
    criticalLatencyP95Ms: 2500,
    highSaturationPercent: 80,
    criticalSaturationPercent: 90,
    highSecurityFindingCount: 1,
    criticalSecurityFindingCount: 5,
    highRollbackCount: 1,
    criticalRollbackCount: 2,
  })

type CompleteThresholds = typeof DEFAULT_PREFLIGHT_RISK_THRESHOLDS

interface RowContext {
  metadata: SplunkSearchMetadata
  row: SplunkQueryRow
  rowIndex: number
}

interface FieldRead<T> {
  key: string
  value: T
}

interface SignalDraft {
  key: string
  category: PreflightRiskCategory
  severity: PreflightSeverity
  score: number
  title: string
  description: string
  metrics: Record<string, number>
  evidence: PreflightEvidence
}

const PREFLIGHT_SEVERITY_SCORE: Record<PreflightSeverity, number> = {
  low: 20,
  medium: 45,
  high: 70,
  critical: 90,
}

const PREFLIGHT_SEVERITY_RANK: Record<PreflightSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

const EVIDENCE_FIELD_CANDIDATES = [
  'release_id',
  'release',
  'service',
  'environment',
  'status',
  'severity',
  'risk_score',
  'risk_level',
  'message',
  'error_count',
  'failure_count',
  'request_count',
  'event_count',
] as const

export function buildPreflightRiskReport(input: unknown): PreflightRiskReport {
  const parsed = preflightRiskReportInputSchema.parse(input)
  const contexts = flattenRows(parsed.results)
  const signals = extractPreflightRiskSignals(parsed.results, parsed.thresholds)
  const remediationActions = buildRemediationActions(signals, parsed.release)
  const signalsWithActions = attachRemediationActions(signals, remediationActions)
  const score = scorePreflightRiskSignals(signalsWithActions)

  return preflightRiskReportSchema.parse({
    reportId: buildStableId('preflight-report', [
      parsed.release.releaseId,
      parsed.release.service,
      parsed.release.environment,
      parsed.generatedAt,
      String(contexts.length),
      String(score),
    ]),
    generatedAt: parsed.generatedAt,
    release: parsed.release,
    score,
    level: riskLevelForScore(score),
    summary: summarizePreflightRisk(parsed.release, contexts.length, score, signalsWithActions),
    source: buildPreflightSource(parsed.results, contexts),
    signals: signalsWithActions,
    replay: buildPreflightReplayEvents(signalsWithActions),
    remediationActions,
  })
}

export function extractPreflightRiskSignals(
  results: SplunkQueryResult[],
  thresholds: PreflightRiskThresholds = {},
): PreflightRiskSignal[] {
  const resolved = resolvePreflightThresholds(thresholds)
  const drafts = flattenRows(results).flatMap(context => extractSignalDrafts(context, resolved))

  return groupSignalDrafts(drafts)
}

export function buildPreflightReplayEvents(signals: PreflightRiskSignal[]): PreflightReplayEvent[] {
  return [...signals].sort(comparePreflightSignals).map((signal, index) => ({
    id: buildStableId('preflight-replay', [signal.id, String(index + 1)]),
    sequence: index + 1,
    type: signal.score >= 40 ? 'threshold_breach' : 'observation',
    severity: signal.severity,
    title: signal.title,
    description: signal.description,
    signalId: signal.id,
    observedAt: signal.evidence[0]?.time,
    evidence: signal.evidence,
  }))
}

export function buildRemediationActions(
  signals: PreflightRiskSignal[],
  release: ReleaseMetadata,
): RemediationAction[] {
  return signals.map(signal => ({
    id: buildStableId('preflight-remediation', [signal.id]),
    title: remediationTitle(signal.category),
    description: remediationDescription(signal.category, release),
    category: signal.category,
    priority: remediationPriority(signal.severity),
    status: 'proposed',
    verificationQuery: buildVerificationQuery(signal, release),
    relatedSignalIds: [signal.id],
  }))
}

export function scorePreflightRiskSignals(signals: PreflightRiskSignal[]): number {
  if (signals.length === 0) return 0

  const [highest = 0, ...rest] = signals
    .map(signal => signal.score)
    .sort((left, right) => right - left)
  const correlatedLift = rest.reduce((total, score) => total + score * 0.15, 0)

  return clampScore(Math.round(highest + Math.min(correlatedLift, 20)))
}

export function riskLevelForScore(score: number): PreflightRiskReport['level'] {
  if (score >= 85) return 'critical'
  if (score >= 65) return 'high'
  if (score >= 35) return 'moderate'
  return 'low'
}

function resolvePreflightThresholds(overrides: PreflightRiskThresholds = {}): CompleteThresholds {
  return { ...DEFAULT_PREFLIGHT_RISK_THRESHOLDS, ...overrides }
}

function flattenRows(results: SplunkQueryResult[]): RowContext[] {
  return results.flatMap(result =>
    result.rows.map((row, rowIndex) => ({
      metadata: result.metadata,
      row,
      rowIndex,
    })),
  )
}

function extractSignalDrafts(context: RowContext, thresholds: CompleteThresholds): SignalDraft[] {
  return [
    ...extractExplicitRiskSignal(context),
    ...extractSeveritySignal(context),
    ...extractErrorRateSignal(context, thresholds),
    ...extractErrorCountSignal(context, thresholds),
    ...extractLatencySignal(context, thresholds),
    ...extractSaturationSignals(context, thresholds),
    ...extractSecuritySignals(context, thresholds),
    ...extractDeploymentSignals(context, thresholds),
  ]
}

function extractExplicitRiskSignal(context: RowContext): SignalDraft[] {
  const riskScore = readPreflightNumber(context.row, [
    'risk_score',
    'riskScore',
    'release_risk_score',
    'preflight_risk_score',
  ])

  if (!riskScore || riskScore.value <= 0) return []

  const score = clampScore(riskScore.value)
  const severity = preflightSeverityForScore(score)

  return [{
    key: 'explicit-risk-score',
    category: 'reliability',
    severity,
    score,
    title: 'Splunk risk score reported elevated release risk',
    description: 'A Splunk result supplied an explicit release risk score above zero.',
    metrics: { riskScore: score },
    evidence: buildPreflightEvidence(context, [riskScore.key]),
  }]
}

function extractSeveritySignal(context: RowContext): SignalDraft[] {
  const severity = readPreflightString(context.row, ['risk_level', 'riskLevel', 'severity', 'level', 'log_level'])
  if (!severity) return []

  const mapped = mapPreflightSeverity(severity.value)
  if (!mapped || mapped === 'low') return []

  return [{
    key: 'severity-level',
    category: 'reliability',
    severity: mapped,
    score: PREFLIGHT_SEVERITY_SCORE[mapped],
    title: 'High-severity release event present in Splunk',
    description: 'A Splunk row reported elevated severity tied to the release.',
    metrics: { severityRank: PREFLIGHT_SEVERITY_RANK[mapped] },
    evidence: buildPreflightEvidence(context, [severity.key]),
  }]
}

function extractErrorRateSignal(context: RowContext, thresholds: CompleteThresholds): SignalDraft[] {
  const directRate = readPreflightNumber(context.row, ['error_rate', 'errorRate', 'failure_rate', 'failureRate', '5xx_rate', 'http_5xx_rate'])
  const errors = readPreflightNumber(context.row, ['error_count', 'errors', 'failure_count', 'failures', 'failed_count', '5xx_count', 'http_5xx_count'])
  const total = readPreflightNumber(context.row, ['request_count', 'requests', 'event_count', 'events', 'total_count', 'count', 'total'])
  const rate = directRate
    ? normalizeRatio(directRate.value)
    : errors && total && total.value > 0
      ? errors.value / total.value
      : undefined

  if (rate === undefined || rate < thresholds.warningErrorRate) return []

  const severity = thresholdPreflightSeverity(rate, thresholds.warningErrorRate, thresholds.highErrorRate, thresholds.criticalErrorRate)
  const evidenceKeys = [directRate?.key, errors?.key, total?.key].filter(isString)

  return [{
    key: 'error-rate',
    category: 'reliability',
    severity,
    score: scoreThreshold(rate, thresholds.criticalErrorRate, severity),
    title: 'Release error rate breached preflight threshold',
    description: 'Splunk telemetry shows the release error or failure rate above the configured warning threshold.',
    metrics: { errorRate: roundMetric(rate) },
    evidence: buildPreflightEvidence(context, evidenceKeys),
  }]
}

function extractErrorCountSignal(context: RowContext, thresholds: CompleteThresholds): SignalDraft[] {
  const errors = readPreflightNumber(context.row, ['error_count', 'errors', 'failure_count', 'failures', 'failed_count', 'exception_count', 'exceptions', 'timeout_count', 'timeouts'])
  if (!errors || errors.value < thresholds.warningErrorCount) return []

  const severity = thresholdPreflightSeverity(errors.value, thresholds.warningErrorCount, thresholds.highErrorCount, thresholds.criticalErrorCount)

  return [{
    key: 'error-count',
    category: 'reliability',
    severity,
    score: scoreThreshold(errors.value, thresholds.criticalErrorCount, severity),
    title: 'Release failures accumulated in Splunk',
    description: 'Splunk telemetry shows errors, failures, exceptions, or timeouts for the release.',
    metrics: { errorCount: Math.round(errors.value) },
    evidence: buildPreflightEvidence(context, [errors.key]),
  }]
}

function extractLatencySignal(context: RowContext, thresholds: CompleteThresholds): SignalDraft[] {
  const latencyMs =
    readPreflightNumber(context.row, ['latency_p95_ms', 'p95_latency_ms', 'p95_ms', 'response_time_p95_ms', 'duration_p95_ms']) ??
    multiplyRead(readPreflightNumber(context.row, ['latency_p95_seconds', 'p95_seconds', 'response_time_p95_seconds']), 1000)

  if (!latencyMs || latencyMs.value < thresholds.highLatencyP95Ms) return []

  const severity = latencyMs.value >= thresholds.criticalLatencyP95Ms ? 'critical' : 'high'

  return [{
    key: 'latency-p95',
    category: 'performance',
    severity,
    score: scoreThreshold(latencyMs.value, thresholds.criticalLatencyP95Ms, severity),
    title: 'P95 latency is above release threshold',
    description: 'Splunk telemetry shows p95 latency above the configured release-risk threshold.',
    metrics: { latencyP95Ms: Math.round(latencyMs.value) },
    evidence: buildPreflightEvidence(context, [latencyMs.key]),
  }]
}

function extractSaturationSignals(context: RowContext, thresholds: CompleteThresholds): SignalDraft[] {
  return [
    {
      key: 'cpu-saturation',
      title: 'CPU saturation threatens release stability',
      metricName: 'cpuPercent',
      read: readPreflightPercent(context.row, ['cpu_pct', 'cpu_percent', 'cpu_usage_pct', 'cpu_usage_percent']),
    },
    {
      key: 'memory-saturation',
      title: 'Memory saturation threatens release stability',
      metricName: 'memoryPercent',
      read: readPreflightPercent(context.row, ['memory_pct', 'memory_percent', 'mem_pct', 'mem_percent', 'memory_usage_pct']),
    },
  ].flatMap(({ key, title, metricName, read }) => {
    if (!read || read.value < thresholds.highSaturationPercent) return []
    const severity = read.value >= thresholds.criticalSaturationPercent ? 'critical' : 'high'

    return [{
      key,
      category: 'capacity' as const,
      severity,
      score: scoreThreshold(read.value, thresholds.criticalSaturationPercent, severity),
      title,
      description: 'Splunk telemetry shows resource saturation above the configured release-risk threshold.',
      metrics: { [metricName]: roundMetric(read.value) },
      evidence: buildPreflightEvidence(context, [read.key]),
    }]
  })
}

function extractSecuritySignals(context: RowContext, thresholds: CompleteThresholds): SignalDraft[] {
  const reads = [
    readPreflightNumber(context.row, ['critical_vulnerabilities', 'critical_vulnerability_count', 'critical_security_findings']),
    readPreflightNumber(context.row, ['vulnerabilities', 'vulnerability_count', 'security_findings', 'security_finding_count', 'policy_violation_count', 'unauthorized_count', 'denied_count']),
  ].filter(isDefined)
  const findingCount = reads.reduce((total, read) => total + read.value, 0)

  if (findingCount < thresholds.highSecurityFindingCount) return []

  const severity = findingCount >= thresholds.criticalSecurityFindingCount ? 'critical' : 'high'

  return [{
    key: 'security-findings',
    category: 'security',
    severity,
    score: scoreThreshold(findingCount, thresholds.criticalSecurityFindingCount, severity),
    title: 'Security findings are present for the release',
    description: 'Splunk telemetry shows vulnerabilities, policy violations, unauthorized access, or denied events tied to the release.',
    metrics: { securityFindingCount: Math.round(findingCount) },
    evidence: buildPreflightEvidence(context, reads.map(read => read.key)),
  }]
}

function extractDeploymentSignals(context: RowContext, thresholds: CompleteThresholds): SignalDraft[] {
  const rollback = readPreflightNumber(context.row, ['rollback_count', 'rollbacks', 'rollback'])
  const status = readPreflightString(context.row, ['deployment_status', 'deploy_status', 'rollout_status', 'status'])
  const signals: SignalDraft[] = []

  if (rollback && rollback.value >= thresholds.highRollbackCount) {
    const severity = rollback.value >= thresholds.criticalRollbackCount ? 'critical' : 'high'
    signals.push({
      key: 'rollback-count',
      category: 'change',
      severity,
      score: scoreThreshold(rollback.value, thresholds.criticalRollbackCount, severity),
      title: 'Rollback activity detected for the release',
      description: 'Splunk telemetry shows rollback activity, raising deployment risk for the release.',
      metrics: { rollbackCount: Math.round(rollback.value) },
      evidence: buildPreflightEvidence(context, [rollback.key]),
    })
  }

  if (status && isUnhealthyDeploymentStatus(status.value)) {
    const severity = deploymentStatusSeverity(status.value)
    signals.push({
      key: 'deployment-status',
      category: 'change',
      severity,
      score: PREFLIGHT_SEVERITY_SCORE[severity],
      title: 'Deployment status is unhealthy',
      description: 'Splunk telemetry reports a failed, degraded, aborted, or rolled-back deployment state.',
      metrics: { unhealthyDeploymentState: 1 },
      evidence: buildPreflightEvidence(context, [status.key]),
    })
  }

  return signals
}

function groupSignalDrafts(drafts: SignalDraft[]): PreflightRiskSignal[] {
  const grouped = new Map<string, SignalDraft[]>()
  for (const draft of drafts) grouped.set(draft.key, [...(grouped.get(draft.key) ?? []), draft])

  return [...grouped.entries()]
    .map(([key, group]) => {
      const lead = [...group].sort(compareSignalDrafts)[0]
      const evidence = group.map(draft => draft.evidence)
      const score = clampScore(Math.max(...group.map(draft => draft.score)))
      const severity = highestPreflightSeverity(group.map(draft => draft.severity))

      return {
        id: buildStableId('preflight-signal', [
          key,
          severity,
          String(score),
          ...evidence.map(item => `${item.searchId ?? ''}:${item.rowIndex}`),
        ]),
        category: lead.category,
        severity,
        score,
        title: lead.title,
        description: lead.description,
        metrics: mergeMetrics(group.map(draft => draft.metrics)),
        evidence,
        remediationActionIds: [],
      }
    })
    .sort(comparePreflightSignals)
}

function attachRemediationActions(signals: PreflightRiskSignal[], actions: RemediationAction[]): PreflightRiskSignal[] {
  const actionBySignalId = new Map(actions.flatMap(action => action.relatedSignalIds.map(signalId => [signalId, action.id] as const)))

  return signals.map(signal => ({
    ...signal,
    remediationActionIds: actionBySignalId.has(signal.id) ? [actionBySignalId.get(signal.id) as string] : [],
  }))
}

function buildPreflightEvidence(context: RowContext, requestedKeys: string[]): PreflightEvidence {
  const fields: Record<string, SplunkFieldValue> = {}
  const contextKeys = EVIDENCE_FIELD_CANDIDATES.map(key => findFieldKey(context.row, key)).filter(isString)

  for (const key of [...requestedKeys, ...contextKeys]) {
    const value = context.row[key]
    if (value !== undefined) fields[key] = value
  }

  return {
    queryName: context.metadata.queryName,
    searchId: context.metadata.searchId,
    rowIndex: context.rowIndex,
    index: asSplunkString(context.row.index),
    source: asSplunkString(context.row.source),
    sourcetype: asSplunkString(context.row.sourcetype),
    host: asSplunkString(context.row.host),
    time: context.row._time,
    fields,
  }
}

function buildPreflightSource(results: SplunkQueryResult[], contexts: RowContext[]): PreflightRiskReport['source'] {
  const indexesByName = new Map<string, SplunkIndex>()
  for (const result of results) for (const index of result.metadata.indexes ?? []) indexesByName.set(index.name, index)
  for (const context of contexts) {
    const indexName = asSplunkString(context.row.index)
    if (indexName && !indexesByName.has(indexName)) indexesByName.set(indexName, { name: indexName })
  }

  return {
    rowCount: contexts.length,
    searchIds: uniqueStrings(results.map(result => result.metadata.searchId).filter(isString)),
    queryNames: uniqueStrings(results.map(result => result.metadata.queryName).filter(isString)),
    indexes: [...indexesByName.values()],
  }
}

function summarizePreflightRisk(release: ReleaseMetadata, rowCount: number, score: number, signals: PreflightRiskSignal[]): string {
  if (signals.length === 0) {
    return `Splunk returned ${rowCount} row(s) for release ${release.releaseId}; no Release Preflight risk signals were detected.`
  }

  const highest = [...signals].sort(comparePreflightSignals)[0]
  return `${riskLevelForScore(score)} release risk (${score}/100) for ${release.service} ${release.releaseId}: ${signals.length} signal(s) from ${rowCount} Splunk row(s). Highest signal: ${highest.title}.`
}

function buildVerificationQuery(signal: PreflightRiskSignal, release: ReleaseMetadata): string | undefined {
  const indexes = uniqueStrings(signal.evidence.map(item => item.index).filter(isString))
  if (indexes.length === 0) return undefined

  const indexFilter = indexes.map(index => `index="${escapeSplunkSearchString(index)}"`).join(' OR ')
  return `search (${indexFilter}) release_id="${escapeSplunkSearchString(release.releaseId)}" service="${escapeSplunkSearchString(release.service)}" | stats count by severity status host`
}

function remediationTitle(category: PreflightRiskCategory): string {
  switch (category) {
    case 'security': return 'Block promotion until security findings are triaged'
    case 'performance': return 'Reduce latency before promotion'
    case 'capacity': return 'Relieve saturation before promotion'
    case 'change': return 'Stabilize the deployment path'
    case 'data_quality': return 'Repair release telemetry quality'
    case 'observability': return 'Restore release observability'
    case 'reliability':
    default: return 'Stabilize release reliability signals'
  }
}

function remediationDescription(category: PreflightRiskCategory, release: ReleaseMetadata): string {
  switch (category) {
    case 'security': return `Triage the security evidence for ${release.service} ${release.releaseId}, fix confirmed exposure, and rerun the verification query before promotion.`
    case 'performance': return `Investigate p95 latency for ${release.service} ${release.releaseId}, reduce the regression, and confirm the threshold clears in Splunk.`
    case 'capacity': return `Increase headroom or reduce load for ${release.service} ${release.releaseId}, then verify saturation returns below threshold.`
    case 'change': return `Inspect deployment events for ${release.service} ${release.releaseId}, resolve failed or rolled-back stages, and rerun release health checks.`
    case 'data_quality': return `Correct malformed or missing telemetry for ${release.service} ${release.releaseId} before relying on the preflight result.`
    case 'observability': return `Restore Splunk coverage for ${release.service} ${release.releaseId} and rerun the preflight query set.`
    case 'reliability':
    default: return `Triage reliability evidence for ${release.service} ${release.releaseId}, reduce failures, and verify the release row set clears risk thresholds.`
  }
}

function remediationPriority(severity: PreflightSeverity): RemediationAction['priority'] {
  if (severity === 'critical') return 'urgent'
  if (severity === 'high') return 'high'
  if (severity === 'medium') return 'medium'
  return 'low'
}

function readPreflightNumber(row: SplunkQueryRow, candidates: readonly string[]): FieldRead<number> | undefined {
  for (const candidate of candidates) {
    const key = findFieldKey(row, candidate)
    const value = key ? asSplunkNumber(row[key]) : undefined
    if (key && value !== undefined) return { key, value }
  }
  return undefined
}

function readPreflightPercent(row: SplunkQueryRow, candidates: readonly string[]): FieldRead<number> | undefined {
  const read = readPreflightNumber(row, candidates)
  return read ? { key: read.key, value: read.value <= 1 ? read.value * 100 : read.value } : undefined
}

function readPreflightString(row: SplunkQueryRow, candidates: readonly string[]): FieldRead<string> | undefined {
  for (const candidate of candidates) {
    const key = findFieldKey(row, candidate)
    const value = key ? asSplunkString(row[key]) : undefined
    if (key && value) return { key, value }
  }
  return undefined
}

function multiplyRead(read: FieldRead<number> | undefined, multiplier: number): FieldRead<number> | undefined {
  return read ? { key: read.key, value: read.value * multiplier } : undefined
}

function findFieldKey(row: SplunkQueryRow, candidate: string): string | undefined {
  const normalizedCandidate = normalizeFieldName(candidate)
  return Object.keys(row).find(key => normalizeFieldName(key) === normalizedCandidate)
}

function normalizeFieldName(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function asSplunkNumber(value: SplunkFieldValue | undefined): number | undefined {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'number' && Number.isFinite(first)) return first
  if (typeof first !== 'string') return undefined

  const match = first.trim().replace(/,/g, '').match(/^-?\d+(\.\d+)?/)
  if (!match) return undefined

  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

function asSplunkString(value: SplunkFieldValue | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'string') {
    const trimmed = first.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof first === 'number' || typeof first === 'boolean') return String(first)
  return undefined
}

function normalizeRatio(value: number): number {
  if (value <= 1) return Math.max(value, 0)
  if (value <= 100) return value / 100
  return 1
}

function thresholdPreflightSeverity(value: number, warning: number, high: number, critical: number): PreflightSeverity {
  if (value >= critical) return 'critical'
  if (value >= high) return 'high'
  if (value >= warning) return 'medium'
  return 'low'
}

function scoreThreshold(value: number, critical: number, severity: PreflightSeverity): number {
  const thresholdScore = critical > 0 ? Math.min(value / critical, 1) * 100 : 0
  return clampScore(Math.max(PREFLIGHT_SEVERITY_SCORE[severity], Math.round(thresholdScore)))
}

function preflightSeverityForScore(score: number): PreflightSeverity {
  if (score >= 85) return 'critical'
  if (score >= 65) return 'high'
  if (score >= 35) return 'medium'
  return 'low'
}

function mapPreflightSeverity(value: string): PreflightSeverity | undefined {
  const normalized = value.toLowerCase()
  if (['critical', 'crit', 'fatal', 'panic', 'emergency'].includes(normalized)) return 'critical'
  if (['high', 'error', 'err', 'severe'].includes(normalized)) return 'high'
  if (['medium', 'warn', 'warning', 'degraded'].includes(normalized)) return 'medium'
  if (['low', 'info', 'notice', 'debug'].includes(normalized)) return 'low'
  return undefined
}

function isUnhealthyDeploymentStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return ['failed', 'failure', 'degraded', 'aborted', 'rolled_back', 'rollback', 'rolling_back'].some(token => normalized.includes(token))
}

function deploymentStatusSeverity(status: string): PreflightSeverity {
  const normalized = status.toLowerCase()
  return normalized.includes('failed') || normalized.includes('aborted') ? 'critical' : 'high'
}

function highestPreflightSeverity(values: PreflightSeverity[]): PreflightSeverity {
  return values.reduce((highest, current) =>
    PREFLIGHT_SEVERITY_RANK[current] > PREFLIGHT_SEVERITY_RANK[highest] ? current : highest,
  )
}

function mergeMetrics(groups: Array<Record<string, number>>): Record<string, number> {
  return groups.reduce<Record<string, number>>((merged, metrics) => {
    for (const [key, value] of Object.entries(metrics)) merged[key] = Math.max(merged[key] ?? 0, value)
    return merged
  }, {})
}

function compareSignalDrafts(left: SignalDraft, right: SignalDraft): number {
  return PREFLIGHT_SEVERITY_RANK[right.severity] - PREFLIGHT_SEVERITY_RANK[left.severity] || right.score - left.score
}

function comparePreflightSignals(left: PreflightRiskSignal, right: PreflightRiskSignal): number {
  return PREFLIGHT_SEVERITY_RANK[right.severity] - PREFLIGHT_SEVERITY_RANK[left.severity] || right.score - left.score || left.title.localeCompare(right.title)
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score))
}

function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000
}

function buildStableId(prefix: string, parts: string[]): string {
  return `${prefix}-${stableHash(parts.join('|'))}`
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function escapeSplunkSearchString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
