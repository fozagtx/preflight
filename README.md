# Release Preflight

Splunk-backed release risk check for a GitHub project link.

Live app: [https://release-preflight.vercel.app](https://release-preflight.vercel.app)

## License

MIT. See [LICENSE](./LICENSE).

## Main Flow

1. Paste a GitHub repository, branch, or commit link.
2. The app reads GitHub metadata for repository name, branch, commit SHA, and package version when available.
3. `POST /api/deployments` writes a deployment marker to Splunk HEC.
4. `POST /api/preflight` runs SPL searches through the Splunk MCP server.
5. The UI shows the verdict, crisis risk, risk depth, Splunk evidence, and recommended fixes.

## Splunk Services Used

| Splunk service | Purpose in this app | Where configured |
| --- | --- | --- |
| Splunk Cloud Platform | Stores and searches the release marker and matching release events. | Splunk tenant behind HEC and MCP |
| HTTP Event Collector | Ingests the deployment marker event. | `SPLUNK_HEC_*` |
| MCP Server for Splunk Platform | Runs Splunk tools from the Next.js API routes. | `SPLUNK_MCP_*` |
| Splunk Search / SPL | Builds summary, error, and recent evidence queries. | `src/lib/preflight/spl.ts` |
| Splunk AI Assistant through MCP | Optional narrative text via `saia_ask_splunk_question` or another configured MCP tool. | `SPLUNK_MCP_AI_TOOL` or `RELEASE_PREFLIGHT_AI_TOOL` |

## Splunk Services Not Configured

These are not wired into the current build:

- Splunk Enterprise Security
- Splunk Observability Cloud
- Splunk IT Service Intelligence
- Splunk SOAR
- AppDynamics

Add one only after the relevant Splunk data source, index, or MCP tool is available.

## Current SPL Coverage

The release report currently searches for:

- matching release events by `service`, `environment`, and `release_id`
- explicit `error`, `critical`, and `fatal` severity
- failure-language signals: timeout, exception, failure, panic, OOM, 5xx, connection refused
- affected host count
- recent evidence rows

Deployment marker rows are counted as release evidence, but excluded from error and failure-language counts with `is_release_marker=0`.

## Adding Enterprise Security

To add Splunk Enterprise Security, wire it as a separate evidence source:

1. Add a security SPL builder in `src/lib/preflight/spl.ts`.
2. Query your ES notable-event index, saved search, or security sourcetype.
3. Call that query from `src/app/api/preflight/route.ts`.
4. Extend `src/lib/preflight/schema.ts` and `src/lib/preflight/report.ts` with security metrics.
5. Render a Security Risk section only when the security query is configured and returns data.

Recommended environment names for that later work:

```bash
SPLUNK_SECURITY_INDEX=notable
SPLUNK_SECURITY_SAVED_SEARCH=
SPLUNK_SECURITY_SOURCETYPE=
```

## Environment Variables

Keep these server-only. Do not use `NEXT_PUBLIC_`.

```bash
SPLUNK_MCP_URL=https://your-splunk-mcp-endpoint.example.com/mcp
SPLUNK_MCP_AUTH_TOKEN=your-mcp-token
SPLUNK_MCP_PROTOCOL_VERSION=2025-11-25
SPLUNK_MCP_TIMEOUT_MS=30000
SPLUNK_MCP_CLIENT_NAME=release-preflight
SPLUNK_MCP_CLIENT_VERSION=0.1.0

SPLUNK_HEC_URL=https://http-inputs-your-stack.splunkcloud.com/services/collector/event
SPLUNK_HEC_TOKEN=your-hec-token
SPLUNK_HEC_TIMEOUT_MS=30000
SPLUNK_HEC_ALLOW_SELF_SIGNED=false
SPLUNK_HEC_INDEX=main
SPLUNK_HEC_SOURCE=release-preflight
SPLUNK_HEC_SOURCETYPE=release_preflight:deployment
SPLUNK_HEC_HOST=
SPLUNK_HEC_CHANNEL=

SPLUNK_MCP_AI_TOOL=saia_ask_splunk_question
RELEASE_PREFLIGHT_REQUIRE_AI=false
```

## Change Points

- Change the HEC destination with `SPLUNK_HEC_URL`, `SPLUNK_HEC_TOKEN`, and `SPLUNK_HEC_INDEX`.
- Change the MCP endpoint with `SPLUNK_MCP_URL` and `SPLUNK_MCP_AUTH_TOKEN`.
- Change the optional narrative tool with `SPLUNK_MCP_AI_TOOL`.
- Tighten search scope by replacing `index=*` in `src/lib/preflight/spl.ts` with your release event index.
- Add security evidence only through a separate security query path.

## Local Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Verify

```bash
npm test -- --run
npm run build
```

## Files

```text
src/app/page.tsx
src/app/api/deployments/route.ts
src/app/api/preflight/route.ts
src/lib/splunk/
src/lib/preflight/
public/release-preflight-logo.png
```
