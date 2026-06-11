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

type FormErrors = Partial<Record<keyof FormState, string>>
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
  environment: 'prod',
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
  const [form, setForm] = useState<FormState>(initialForm)
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [runState, setRunState] = useState<RunState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [markerResult, setMarkerResult] = useState<MarkerResult | null>(null)
  const [markerKey, setMarkerKey] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<FormErrors>({})

  const busy = runState !== 'idle'
  const hasMinimumInput = Boolean(form.service.trim() && form.environment.trim() && form.releaseId.trim())
  const currentMarkerKey = markerKeyFor(form)
  const status = useMemo(() => {
    if (busy) return runState === 'ingesting' ? 'Writing marker to Splunk' : 'Running Splunk analysis'
    if (error) return 'Blocked'
    if (report) return verdictFor(report)
    if (markerResult) return 'Marker written'
    if (hasMinimumInput) return 'Ready to run'
    return 'Enter release details'
  }, [busy, error, hasMinimumInput, markerResult, report, runState])

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }))
    setFormErrors(current => ({ ...current, [key]: undefined }))
    setReport(null)
    setMarkerResult(null)
    setMarkerKey(null)
    setError(null)
  }

  async function writeSplunkMarker(): Promise<MarkerResult> {
    const response = await fetch('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: form.service,
        environment: form.environment,
        releaseId: form.releaseId,
        repository: form.repository || undefined,
        branch: form.branch || undefined,
        commitSha: form.commitSha || undefined,
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
    const validationErrors = validateForm(form)
    setFormErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    const shouldWriteMarker = markerKey !== currentMarkerKey || !markerResult

    setError(null)
    setReport(null)
    if (shouldWriteMarker) {
      setMarkerResult(null)
    }

    try {
      if (shouldWriteMarker) {
        setRunState('ingesting')
        setMarkerResult(await writeSplunkMarker())
        setMarkerKey(currentMarkerKey)
      }

      setRunState('analyzing')

      const response = await fetch('/api/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: form.service,
          environment: form.environment,
          releaseId: form.releaseId,
          repository: form.repository || undefined,
          branch: form.branch || undefined,
          commitSha: form.commitSha || undefined,
          lookbackMinutes: form.lookbackMinutes,
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
            <p>One run writes the Splunk marker, then checks live Splunk evidence.</p>
          </div>

          <div className="form-grid">
            <label>
              Service name
              <input
                required
                value={form.service}
                onChange={event => updateField('service', event.target.value)}
                placeholder="checkout-api"
                aria-invalid={Boolean(formErrors.service)}
                aria-describedby={formErrors.service ? 'service-error' : undefined}
              />
              {formErrors.service && <span className="field-error" id="service-error">{formErrors.service}</span>}
            </label>
            <label>
              Environment name
              <input
                required
                value={form.environment}
                onChange={event => updateField('environment', event.target.value)}
                placeholder="prod"
                aria-invalid={Boolean(formErrors.environment)}
                aria-describedby={formErrors.environment ? 'environment-error' : undefined}
              />
              {formErrors.environment && <span className="field-error" id="environment-error">{formErrors.environment}</span>}
            </label>
            <label>
              Release or version ID
              <input
                required
                value={form.releaseId}
                onChange={event => updateField('releaseId', event.target.value)}
                placeholder="2026.06.11"
                aria-invalid={Boolean(formErrors.releaseId)}
                aria-describedby={formErrors.releaseId ? 'releaseId-error' : undefined}
              />
              {formErrors.releaseId && <span className="field-error" id="releaseId-error">{formErrors.releaseId}</span>}
            </label>
            <label>
              Lookback window (minutes)
              <input
                required
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
                placeholder="https://github.com/fozagtx/eyez"
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
                placeholder="abc1234"
              />
            </label>
          </div>

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
                  : report || markerResult
                    ? 'Check Splunk Again'
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
                  <div className="section-title">Actions</div>
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
