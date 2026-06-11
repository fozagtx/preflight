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

export function buildSummarySpl(request: PreflightRequest): string {
  return `${baseSearch(request)}
| eval normalized_severity=lower(coalesce(severity, level, log_level, priority, "unknown"))
| eval raw_text=lower(coalesce(_raw, message, log, ""))
| stats count as total_events
    count(eval(match(normalized_severity, "error|critical|fatal"))) as error_events
    count(eval(match(raw_text, "exception|timeout|failed|failure|panic|oom|5[0-9][0-9]|connection refused"))) as failure_signals
    dc(host) as affected_hosts
    latest(_time) as latest_time`
}

export function buildErrorsSpl(request: PreflightRequest): string {
  return `${baseSearch(request)}
| eval normalized_severity=lower(coalesce(severity, level, log_level, priority, "unknown"))
| eval raw_text=coalesce(message, log, _raw)
| search normalized_severity="*error*" OR normalized_severity="*critical*" OR normalized_severity="*fatal*" OR raw_text="*timeout*" OR raw_text="*exception*" OR raw_text="*failed*"
| stats count as count latest(raw_text) as latest_message latest(_time) as latest_time by host source sourcetype
| sort - count
| head 8`
}

export function buildRecentSpl(request: PreflightRequest): string {
  return `${baseSearch(request)}
| eval normalized_severity=lower(coalesce(severity, level, log_level, priority, "info"))
| eval raw_text=coalesce(message, log, _raw)
| table _time normalized_severity host source sourcetype raw_text
| sort - _time
| head 12`
}
