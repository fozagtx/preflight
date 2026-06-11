import { describe, expect, it } from 'vitest'
import { buildPreflightReport } from '@/lib/preflight/report'
import { buildErrorsSpl, buildRecentSpl, buildSummarySpl } from '@/lib/preflight/spl'
import type { PreflightRequest } from '@/lib/preflight/schema'

const request: PreflightRequest = {
  service: 'release-preflight',
  environment: 'production',
  releaseId: '0.1.0',
  repository: 'https://github.com/fozagtx/preflight',
  branch: 'main',
  commitSha: 'test-commit-sha',
  lookbackMinutes: 240,
}

describe('Release Preflight SPL builders', () => {
  it('builds service/environment/release scoped searches', () => {
    expect(buildSummarySpl(request)).toContain('service="release-preflight"')
    expect(buildSummarySpl(request)).toContain('environment="production"')
    expect(buildSummarySpl(request)).toContain('release_id="0.1.0"')
    expect(buildSummarySpl(request)).toContain('NOT release_id=*')
    expect(buildSummarySpl(request)).toContain('dedup release_preflight_dedupe_key')
    expect(buildSummarySpl(request)).toContain('count(eval(is_release_marker=0 AND match(normalized_severity')
    expect(buildSummarySpl(request)).toContain('(^|[^0-9])5[0-9][0-9]([^0-9]|$)')
    expect(buildRecentSpl(request)).toContain('dedup release_preflight_dedupe_key')
    expect(buildErrorsSpl(request)).toContain('| where is_release_marker=0 AND')
    expect(buildErrorsSpl(request)).toContain('| stats count as count')
    expect(buildRecentSpl(request)).toContain('| table _time normalized_severity')
  })

  it('escapes quoted release inputs', () => {
    const spl = buildSummarySpl({
      ...request,
      service: 'release"preflight',
    })

    expect(spl).toContain('service="release\\"preflight"')
  })
})

describe('Release Preflight report builder', () => {
  it('scores real Splunk rows without fabricating evidence', () => {
    const report = buildPreflightReport({
      request,
      summaryRows: [
        {
          total_events: '1200',
          error_events: '88',
          failure_signals: '42',
          affected_hosts: '6',
        },
      ],
      errorRows: [
        {
          host: 'api-1',
          count: '12',
          latest_message: 'payment timeout',
          latest_time: '2026-06-11T16:00:00Z',
          sourcetype: 'app:checkout',
        },
      ],
      recentRows: [],
      aiNarrative: 'Hold release: payment timeout pressure is active.',
      spl: {
        summary: 'summary spl',
        errors: 'errors spl',
        recent: 'recent spl',
      },
    })

    expect(report.riskScore).toBeGreaterThan(0)
    expect(report.evidence).toHaveLength(1)
    expect(report.evidence[0].detail).toBe('payment timeout')
    expect(report.aiNarrative).toContain('Hold release')
  })
})
