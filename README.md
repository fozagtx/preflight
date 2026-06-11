# Release Preflight

Checks release risk with live Splunk evidence.

Live app: [https://release-preflight.vercel.app](https://release-preflight.vercel.app)

## Splunk Routes

- `POST /api/deployments`: writes a deployment marker to Splunk HEC.
- `POST /api/preflight`: runs SPL through Splunk MCP and returns the release verdict.

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

RELEASE_PREFLIGHT_AI_TOOL=saia_ask_splunk_question
RELEASE_PREFLIGHT_REQUIRE_AI=false
```

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
