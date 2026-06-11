import type { PreflightRequest } from './schema'

function escapeSplunkValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function baseSearch(request: PreflightRequest): string {
  const service = escapeSplunkValue(request.service)
  const environment = escapeSplunkValue(request.environment)
  const releaseId = escapeSplunkValue(request.releaseId)

  return `search index=* earliest=-${request.lookbackMinutes}m ((service="${service}" OR app="${service}" OR source="*${service}*" OR sourcetype="*${service}*") (environment="${environment}" OR env="${environment}" OR kubernetes.namespace_name="${environment}") (release_id="${releaseId}" OR release="${releaseId}" OR version="${releaseId}" OR (NOT release_id=* NOT release=* NOT version=*)))`
}

function dedupeDeploymentMarkersSpl(): string {
  return `| eval raw_text=coalesce(_raw, message, log, "")
| eval marker_release_id=coalesce(release_id, release, version)
| eval marker_service=coalesce(service, app)
| eval marker_environment=coalesce(environment, env, 'kubernetes.namespace_name')
| eval is_release_marker=if((event_type="deployment" OR match(raw_text, "\\\"event_type\\\":\\\"deployment\\\"")) AND isnotnull(marker_release_id), 1, 0)
| eval release_preflight_dedupe_key=if(is_release_marker=1, "marker:".coalesce(marker_service, "").":".coalesce(marker_environment, "").":".marker_release_id, tostring(_time).":".md5(raw_text))
| dedup release_preflight_dedupe_key`
}

export function buildSummarySpl(request: PreflightRequest): string {
  return `${baseSearch(request)}
${dedupeDeploymentMarkersSpl()}
| eval normalized_severity=lower(coalesce(severity, level, log_level, priority, "unknown"))
| eval raw_text=lower(raw_text)
| stats count as total_events
    count(eval(is_release_marker=0 AND match(normalized_severity, "error|critical|fatal"))) as error_events
    count(eval(is_release_marker=0 AND match(raw_text, "exception|timeout|failed|failure|panic|oom|(^|[^0-9])5[0-9][0-9]([^0-9]|$)|connection refused"))) as failure_signals
    dc(host) as affected_hosts
    latest(_time) as latest_time`
}

export function buildErrorsSpl(request: PreflightRequest): string {
  return `${baseSearch(request)}
${dedupeDeploymentMarkersSpl()}
| eval normalized_severity=lower(coalesce(severity, level, log_level, priority, "unknown"))
| eval raw_text=lower(raw_text)
| where is_release_marker=0 AND (match(normalized_severity, "error|critical|fatal") OR match(raw_text, "exception|timeout|failed|failure|panic|oom|(^|[^0-9])5[0-9][0-9]([^0-9]|$)|connection refused"))
| stats count as count latest(raw_text) as latest_message latest(_time) as latest_time by host source sourcetype
| sort - count
| head 8`
}

export function buildRecentSpl(request: PreflightRequest): string {
  return `${baseSearch(request)}
${dedupeDeploymentMarkersSpl()}
| eval normalized_severity=lower(coalesce(severity, level, log_level, priority, "info"))
| table _time normalized_severity host source sourcetype raw_text
| sort - _time
| head 12`
}
