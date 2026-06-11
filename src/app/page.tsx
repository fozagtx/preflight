'use client'

import { FormEvent, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  DatabaseZap,
  Loader2,
  RadioTower,
  ShieldAlert,
} from 'lucide-react'
import type { PreflightReport } from '@/types'

type FormState = {
  service: string
  environment: string
  releaseId: string
  repository: string
  branch: string
  commitSha: string
  lookbackMinutes: number
}

type FormErrors = Partial<Record<keyof FormState | 'projectLink', string>>
type LinkStatus = {
  kind: 'idle' | 'loading' | 'ready' | 'error'
  message: string
}
type ParsedGithubLink = {
  owner: string
  repo: string
  repository: string
  branch?: string
  commitSha?: string
}
type MarkerReceipt = {
  text?: string
  code?: number
  ackId?: number
}
type MarkerResult = {
  accepted: number
  receipts: MarkerReceipt[]
  ingestedAt: string
}

const initialForm: FormState = {
  service: '',
  environment: 'production',
  releaseId: '',
  repository: '',
  branch: 'main',
  commitSha: '',
  lookbackMinutes: 240,
}

type RunState = 'idle' | 'ingesting' | 'analyzing'

function markerKeyFor(form: FormState): string {
  return [
    form.service.trim(),
    form.environment.trim(),
    form.releaseId.trim(),
    form.repository.trim(),
    form.branch.trim(),
    form.commitSha.trim(),
  ].join('|')
}

function parseGithubLink(value: string): ParsedGithubLink | null {
  const raw = value.trim()
  if (!raw) return null

  const sshMatch = raw.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/)
  if (sshMatch) {
    const repo = sshMatch[2].replace(/\.git$/, '')
    return {
      owner: sshMatch[1],
      repo,
      repository: `https://github.com/${sshMatch[1]}/${repo}`,
    }
  }

  try {
    const url = new URL(raw)
    if (!url.hostname.endsWith('github.com')) return null
    const [owner, repoSegment, type, ...rest] = url.pathname.split('/').filter(Boolean)
    if (!owner || !repoSegment) return null

    const repo = repoSegment.replace(/\.git$/, '')
    const parsed: ParsedGithubLink = {
      owner,
      repo,
      repository: `https://github.com/${owner}/${repo}`,
    }

    if (type === 'commit' && rest[0]) parsed.commitSha = rest[0]
    if (type === 'tree' && rest.length > 0) parsed.branch = rest.join('/')

    return parsed
  } catch {
    return null
  }
}

function applyGithubLinkToForm(form: FormState, parsed: ParsedGithubLink): FormState {
  const commitSha = parsed.commitSha ?? form.commitSha

  return {
    ...form,
    service: parsed.repo,
    environment: form.environment.trim() || 'production',
    releaseId: parsed.commitSha ? parsed.commitSha.slice(0, 12) : form.releaseId,
    repository: parsed.repository,
    branch: parsed.branch ?? (form.branch || 'main'),
    commitSha,
  }
}

async function readGithubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

async function resolveGithubLinkForm(value: string, baseForm: FormState): Promise<FormState> {
  const parsed = parseGithubLink(value)
  if (!parsed) throw new Error('Paste a GitHub repository, branch, or commit link.')

  let next = applyGithubLinkToForm(baseForm, parsed)
  const repo = await readGithubJson<{ default_branch?: string }>(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`
  )
  const branch = parsed.branch ?? repo.default_branch ?? next.branch ?? 'main'

  let commitSha = parsed.commitSha ?? next.commitSha
  if (!commitSha) {
    const commit = await readGithubJson<{ sha?: string }>(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(branch)}`
    )
    commitSha = commit.sha ?? ''
  }

  let releaseId = next.releaseId
  if (!releaseId) {
    try {
      const packageFile = await readGithubJson<{ content?: string }>(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/package.json?ref=${encodeURIComponent(branch)}`
      )
      const packageJson = packageFile.content
        ? JSON.parse(atob(packageFile.content.replace(/\s/g, ''))) as { version?: string }
        : null
      releaseId = packageJson?.version ?? ''
    } catch {
      releaseId = ''
    }
  }

  return {
    ...next,
    branch,
    commitSha,
    releaseId: releaseId || commitSha.slice(0, 12),
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (body?.error && body?.detail) return `${body.error}: ${body.detail}`
    return body?.error || `${response.status} ${response.statusText}`
  } catch {
    return `${response.status} ${response.statusText}`
  }
}

function verdictFor(report: PreflightReport): string {
  if (report.riskScore >= 80) return 'Hold release'
  if (report.riskScore >= 60) return 'Canary only'
  if (report.riskScore >= 35) return 'Ship guarded'
  return 'Ship'
}

function scoreClass(report: PreflightReport | null): string {
  if (!report) return 'score-neutral'
  if (report.riskScore >= 80) return 'score-critical'
  if (report.riskScore >= 60) return 'score-high'
  if (report.riskScore >= 35) return 'score-medium'
  return 'score-low'
}

function crisisRiskLabel(report: PreflightReport): string {
  if (report.riskScore >= 80) return 'Critical crisis risk'
  if (report.riskScore >= 60) return 'High crisis risk'
  if (report.riskScore >= 35) return 'Moderate crisis risk'
  return 'Low crisis risk'
}

function riskDepthRows(report: PreflightReport) {
  const { totalEvents, errorEvents, failureSignals, affectedHosts } = report.metrics

  return [
    {
      label: 'Splunk coverage',
      level: totalEvents === 0 ? 'critical' : 'clear',
      value: `${totalEvents.toLocaleString()} event${totalEvents === 1 ? '' : 's'}`,
      finding: totalEvents === 0
        ? 'No release evidence returned for this service, environment, release, and lookback.'
        : 'Splunk returned release evidence for this run.',
      fix: totalEvents === 0
        ? 'Add service, environment, and release_id fields to deployment/application logs, then rerun Release Preflight.'
        : 'Keep the marker and release fields stable across deploys so future checks stay traceable.',
    },
    {
      label: 'Explicit errors',
      level: errorEvents > 0 ? 'critical' : 'clear',
      value: errorEvents.toLocaleString(),
      finding: errorEvents > 0
        ? 'Splunk rows include error, critical, or fatal severity.'
        : 'No explicit error severity matched this release window.',
      fix: errorEvents > 0
        ? 'Open the top error source/host in Splunk, patch the failing path, redeploy, then rerun this report.'
        : 'No error fix required from current Splunk evidence.',
    },
    {
      label: 'Failure language',
      level: failureSignals > 0 ? 'high' : 'clear',
      value: failureSignals.toLocaleString(),
      finding: failureSignals > 0
        ? 'Raw events contain timeout, exception, failure, panic, OOM, 5xx, or connection-refused language.'
        : 'No failure-language signal matched this release window.',
      fix: failureSignals > 0
        ? 'Search the returned SPL for the exact term, fix the owner service, and confirm the count drops to zero.'
        : 'No failure-language fix required from current Splunk evidence.',
    },
    {
      label: 'Blast radius',
      level: affectedHosts >= 5 ? 'high' : affectedHosts > 1 ? 'medium' : 'clear',
      value: `${affectedHosts.toLocaleString()} host${affectedHosts === 1 ? '' : 's'}`,
      finding: affectedHosts > 1
        ? 'The release signal appears on more than one host.'
        : 'The release signal is contained to one affected host.',
      fix: affectedHosts > 1
        ? 'Keep rollout staged by host or cohort until the same query returns stable low-risk evidence.'
        : 'Proceed with normal observation for this host scope.',
    },
  ]
}

function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {}

  if (!form.service.trim()) errors.service = 'Service name is required.'
  if (!form.environment.trim()) errors.environment = 'Environment name is required.'
  if (!form.releaseId.trim()) errors.releaseId = 'Release or version ID is required.'
  if (!Number.isInteger(form.lookbackMinutes) || form.lookbackMinutes < 5 || form.lookbackMinutes > 10080) {
    errors.lookbackMinutes = 'Use minutes, from 5 to 10080.'
  }

  return errors
}

function isPreflightReport(value: unknown): value is PreflightReport {
  const report = value as PreflightReport
  return Boolean(
    report &&
      typeof report.service === 'string' &&
      typeof report.releaseId === 'string' &&
      typeof report.riskScore === 'number' &&
      Array.isArray(report.evidence) &&
      Array.isArray(report.remediations)
  )
}

export default function HomePage() {
  const [projectLink, setProjectLink] = useState('')
  const [linkStatus, setLinkStatus] = useState<LinkStatus>({ kind: 'idle', message: '' })
  const [form, setForm] = useState<FormState>(initialForm)
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [runState, setRunState] = useState<RunState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [markerResult, setMarkerResult] = useState<MarkerResult | null>(null)
  const [markerKey, setMarkerKey] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<FormErrors>({})

  const busy = runState !== 'idle'
  const hasMinimumInput = Boolean(form.service.trim() && form.environment.trim() && form.releaseId.trim())
  const status = useMemo(() => {
    if (busy) return runState === 'ingesting' ? 'Writing marker to Splunk' : 'Running Splunk analysis'
    if (error) return 'Blocked'
    if (report) return verdictFor(report)
    if (markerResult) return 'Marker written'
    if (hasMinimumInput) return 'Ready to run'
    return 'Enter release details'
  }, [busy, error, hasMinimumInput, markerResult, report, runState])

  function clearRunState() {
    setReport(null)
    setMarkerResult(null)
    setMarkerKey(null)
    setError(null)
  }

  function updateProjectLink(value: string) {
    const parsed = parseGithubLink(value)

    setProjectLink(value)
    setFormErrors(current => ({ ...current, projectLink: undefined }))
    clearRunState()

    if (!value.trim()) {
      setLinkStatus({ kind: 'idle', message: '' })
      return
    }

    if (!parsed) {
      setLinkStatus({ kind: 'error', message: 'Use a GitHub repository, branch, or commit link.' })
      return
    }

    setForm(current => applyGithubLinkToForm(current, parsed))
    setLinkStatus({ kind: 'ready', message: `Detected ${parsed.owner}/${parsed.repo}` })
  }

  async function hydrateProjectLink(value = projectLink, baseForm = form): Promise<FormState> {
    if (!value.trim()) return baseForm

    setLinkStatus({ kind: 'loading', message: 'Reading GitHub metadata' })

    try {
      const resolvedForm = await resolveGithubLinkForm(value, baseForm)
      setForm(resolvedForm)
      setLinkStatus({ kind: 'ready', message: `Loaded ${resolvedForm.service} from GitHub` })
      return resolvedForm
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not read that GitHub link.'
      setLinkStatus({ kind: 'error', message })
      throw caught
    }
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }))
    setFormErrors(current => ({ ...current, [key]: undefined }))
    clearRunState()
  }

  async function writeSplunkMarker(release: FormState): Promise<MarkerResult> {
    const response = await fetch('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: release.service,
        environment: release.environment,
        releaseId: release.releaseId,
        repository: release.repository || undefined,
        branch: release.branch || undefined,
        commitSha: release.commitSha || undefined,
      }),
    })

    if (!response.ok) throw new Error(await readApiError(response))

    const body = await response.json()
    return {
      accepted: Number(body.accepted ?? 0),
      receipts: Array.isArray(body.receipts) ? body.receipts : [],
      ingestedAt: String(body._meta?.ingestedAt ?? new Date().toISOString()),
    }
  }

  async function runPreflight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    let release = form
    if (projectLink.trim()) {
      try {
        release = await hydrateProjectLink(projectLink, form)
      } catch {
        const validationErrors: FormErrors = { projectLink: 'Paste a reachable GitHub repository, branch, or commit link.' }
        setFormErrors(validationErrors)
        return
      }
    }

    const validationErrors = validateForm(release)
    if (!projectLink.trim() && (validationErrors.service || validationErrors.releaseId)) {
      validationErrors.projectLink = 'Paste a GitHub link or open Advanced details.'
    }
    setFormErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    const releaseMarkerKey = markerKeyFor(release)
    const shouldWriteMarker = markerKey !== releaseMarkerKey || !markerResult

    setError(null)
    setReport(null)
    if (shouldWriteMarker) {
      setMarkerResult(null)
    }

    try {
      if (shouldWriteMarker) {
        setRunState('ingesting')
        setMarkerResult(await writeSplunkMarker(release))
        setMarkerKey(releaseMarkerKey)
      }

      setRunState('analyzing')

      const response = await fetch('/api/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: release.service,
          environment: release.environment,
          releaseId: release.releaseId,
          repository: release.repository || undefined,
          branch: release.branch || undefined,
          commitSha: release.commitSha || undefined,
          lookbackMinutes: release.lookbackMinutes,
        }),
      })

      if (!response.ok) throw new Error(await readApiError(response))

      const body = await response.json()
      if (!isPreflightReport(body?.report)) {
        throw new Error('Release Preflight returned no usable report.')
      }
      setReport(body.report)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Release Preflight run failed')
    } finally {
      setRunState('idle')
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Run status">
        <div className="brand-lockup">
          <div className="brand-mark">
            <img src="/release-preflight-logo.png" alt="" aria-hidden="true" />
          </div>
          <div>
            <strong>Release Preflight</strong>
            <span>Splunk release risk agent</span>
          </div>
        </div>
        <div className={`status-pill ${error ? 'status-error' : report ? scoreClass(report) : markerResult ? 'status-ok' : ''}`}>
          {busy ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <RadioTower aria-hidden="true" size={16} />}
          {status}
        </div>
      </section>

      <section className="workspace">
        <form className="control-panel" onSubmit={runPreflight}>
          <div className="panel-heading">
            <h1>Check release risk before deployment.</h1>
            <p>Paste a GitHub link. Release Preflight fills the details from real repository metadata, writes the Splunk marker, then checks live Splunk evidence.</p>
          </div>

          <label className="link-field">
            GitHub link
            <input
              value={projectLink}
              onBlur={() => void hydrateProjectLink()}
              onChange={event => updateProjectLink(event.target.value)}
              placeholder="https://github.com/fozagtx/preflight"
              aria-invalid={Boolean(formErrors.projectLink)}
              aria-describedby={formErrors.projectLink || linkStatus.message ? 'project-link-status' : undefined}
            />
            {(formErrors.projectLink || linkStatus.message) && (
              <span
                className={formErrors.projectLink || linkStatus.kind === 'error' ? 'field-error' : 'link-status'}
                id="project-link-status"
              >
                {formErrors.projectLink || linkStatus.message}
              </span>
            )}
          </label>

          <details className="advanced-fields">
            <summary>Advanced details</summary>
            <div className="form-grid">
              <label>
                Service name
                <input
                  value={form.service}
                  onChange={event => updateField('service', event.target.value)}
                  placeholder="your-service"
                  aria-invalid={Boolean(formErrors.service)}
                  aria-describedby={formErrors.service ? 'service-error' : undefined}
                />
                {formErrors.service && <span className="field-error" id="service-error">{formErrors.service}</span>}
              </label>
              <label>
                Environment name
                <input
                  value={form.environment}
                  onChange={event => updateField('environment', event.target.value)}
                  placeholder="production"
                  aria-invalid={Boolean(formErrors.environment)}
                  aria-describedby={formErrors.environment ? 'environment-error' : undefined}
                />
                {formErrors.environment && <span className="field-error" id="environment-error">{formErrors.environment}</span>}
              </label>
              <label>
                Release or version ID
                <input
                  value={form.releaseId}
                  onChange={event => updateField('releaseId', event.target.value)}
                  placeholder="package version or commit"
                  aria-invalid={Boolean(formErrors.releaseId)}
                  aria-describedby={formErrors.releaseId ? 'releaseId-error' : undefined}
                />
                {formErrors.releaseId && <span className="field-error" id="releaseId-error">{formErrors.releaseId}</span>}
              </label>
              <label>
                Lookback window (minutes)
                <input
                  min={5}
                  max={10080}
                  type="number"
                  value={form.lookbackMinutes}
                  onChange={event => updateField('lookbackMinutes', Number(event.target.value))}
                  aria-invalid={Boolean(formErrors.lookbackMinutes)}
                  aria-describedby={formErrors.lookbackMinutes ? 'lookback-error' : undefined}
                />
                {formErrors.lookbackMinutes && <span className="field-error" id="lookback-error">{formErrors.lookbackMinutes}</span>}
              </label>
              <label className="wide">
                Repository URL
                <input
                  value={form.repository}
                  onChange={event => updateField('repository', event.target.value)}
                  placeholder="https://github.com/fozagtx/preflight"
                />
              </label>
              <label>
                Git branch
                <input
                  value={form.branch}
                  onChange={event => updateField('branch', event.target.value)}
                  placeholder="main"
                />
              </label>
              <label>
                Commit SHA
                <input
                  value={form.commitSha}
                  onChange={event => updateField('commitSha', event.target.value)}
                  placeholder="resolved from GitHub"
                />
              </label>
            </div>
          </details>

          {error && (
            <div className="message message-error" role="alert">
              <AlertTriangle aria-hidden="true" size={18} />
              {error}
            </div>
          )}

          {markerResult && <MarkerReceiptPanel result={markerResult} />}

          <div className="actions">
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <Loader2 className="spin" aria-hidden="true" size={18} /> : <ArrowRight aria-hidden="true" size={18} />}
              {runState === 'ingesting'
                ? 'Writing marker'
                : runState === 'analyzing'
                  ? 'Checking Splunk'
                  : 'Run Release Preflight'}
            </button>
          </div>
        </form>

        <section className={`report-panel ${scoreClass(report)}`} aria-label="Release Preflight report">
          {!report ? (
            <div className="empty-report">
              <DatabaseZap aria-hidden="true" size={42} />
              <h2>No report yet</h2>
              <p>Fill in the release details, then run the Splunk evidence check.</p>
            </div>
          ) : (
            <>
              <div className="report-hero">
                <div>
                  <span className="section-label">Verdict</span>
                  <h2>{verdictFor(report)}</h2>
                  <p>{report.summary}</p>
                </div>
                <div className="score-dial">
                  <span>{report.riskScore}</span>
                  <small>{report.riskLevel}</small>
                </div>
              </div>

              <div className="metric-row">
                <Metric label="Events" value={report.metrics.totalEvents} />
                <Metric label="Errors" value={report.metrics.errorEvents} />
                <Metric label="Failure signals" value={report.metrics.failureSignals} />
                <Metric label="Hosts" value={report.metrics.affectedHosts} />
              </div>

              <section className="risk-depth-panel" aria-label="Crisis risk and recommended fixes">
                <div className="risk-depth-header">
                  <div>
                    <span className="section-label">Crisis risk</span>
                    <h3>{crisisRiskLabel(report)}</h3>
                  </div>
                  <strong>{report.riskScore}/100</strong>
                </div>
                <div className="risk-depth-grid">
                  {riskDepthRows(report).map(row => (
                    <article className={`risk-depth-card depth-${row.level}`} key={row.label}>
                      <div>
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                      </div>
                      <p>{row.finding}</p>
                      <small>{row.fix}</small>
                    </article>
                  ))}
                </div>
              </section>

              {report.metrics.totalEvents === 0 && (
                <div className="message message-warning" role="status">
                  <AlertTriangle aria-hidden="true" size={18} />
                  No Splunk events matched this service, release, environment, and lookback window.
                </div>
              )}

              <section className="ai-panel">
                <div className="section-title">
                  <ShieldAlert aria-hidden="true" size={18} />
                  Decision narrative
                </div>
                <p>{report.aiNarrative}</p>
              </section>

              <section className="split-grid">
                <div>
                  <div className="section-title">Evidence</div>
                  <div className="timeline-list">
                    {report.evidence.length === 0 ? (
                      <p className="muted">No matching evidence rows were returned.</p>
                    ) : (
                      report.evidence.map((event, index) => (
                        <article className={`event-row event-${event.severity}`} key={`${event.time}-${index}`}>
                          <time>{event.time}</time>
                          <strong>{event.title}</strong>
                          <p>{event.detail}</p>
                          {event.source && <span>{event.source}</span>}
                        </article>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <div className="section-title">Recommended fixes</div>
                  <div className="action-list">
                    {report.remediations.length === 0 ? (
                      <p className="muted">No remediation actions were returned.</p>
                    ) : (
                      report.remediations.map(action => (
                        <article key={action.title}>
                          <strong>{action.title}</strong>
                          {action.command && <code>{action.command}</code>}
                          <p>{action.reason}</p>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              </section>

              <details className="spl-block">
                <summary>SPL used for this report</summary>
                <pre>{report.spl.summary}</pre>
                <pre>{report.spl.errors}</pre>
                <pre>{report.spl.recent}</pre>
              </details>
            </>
          )}
        </section>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  )
}

function MarkerReceiptPanel({ result }: { result: MarkerResult }) {
  const firstReceipt = result.receipts[0]

  return (
    <div className="message message-ok marker-receipt" role="status">
      <CheckCircle2 aria-hidden="true" size={18} />
      <div>
        <strong>Marker written to Splunk</strong>
        <span>
          Accepted {result.accepted.toLocaleString()} event{result.accepted === 1 ? '' : 's'} at{' '}
          {new Date(result.ingestedAt).toLocaleString()}.
        </span>
        {firstReceipt && (
          <dl>
            <div>
              <dt>HEC result</dt>
              <dd>{firstReceipt.text ?? 'Accepted'}</dd>
            </div>
            {firstReceipt.code !== undefined && (
              <div>
                <dt>Code</dt>
                <dd>{firstReceipt.code}</dd>
              </div>
            )}
            {firstReceipt.ackId !== undefined && (
              <div>
                <dt>Ack ID</dt>
                <dd>{firstReceipt.ackId}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </div>
  )
}
