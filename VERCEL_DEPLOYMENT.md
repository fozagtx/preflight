# Vercel Deployment

Release Preflight can run on Vercel because Splunk calls stay in server-side API routes. The browser never sees Splunk secrets; `/api/deployments` and `/api/preflight` read Splunk credentials from server environment variables.

## Will It Work on Vercel?

Yes, with the right Splunk endpoints and Vercel environment variables.

Production project:

```text
release-preflight
```

Production URL:

```text
https://release-preflight.vercel.app
```

Production Splunk Cloud should use a valid HEC endpoint such as:

```text
https://http-inputs-<stack>.splunkcloud.com/services/collector/event
```

Some trial stacks expose HEC on the Splunk Cloud host and can present Splunk's default self-signed certificate. If your trial HEC endpoint requires it, set:

```text
SPLUNK_HEC_ALLOW_SELF_SIGNED=true
```

For production Splunk Cloud, use a proper `http-inputs` HEC endpoint and set:

```text
SPLUNK_HEC_ALLOW_SELF_SIGNED=false
```

## Vercel Environment Variables

Set these in Vercel Project Settings -> Environment Variables for Production and Preview:

```text
SPLUNK_MCP_URL=https://<your-splunk-cloud-host>:443/en-US/splunkd/__raw/services/mcp
SPLUNK_MCP_AUTH_TOKEN=<mcp-encrypted-token>
SPLUNK_MCP_PROTOCOL_VERSION=2025-11-25
SPLUNK_MCP_TIMEOUT_MS=30000
SPLUNK_MCP_CLIENT_NAME=release-preflight
SPLUNK_MCP_CLIENT_VERSION=0.1.0

SPLUNK_HEC_URL=https://http-inputs-<stack>.splunkcloud.com/services/collector/event
SPLUNK_HEC_TOKEN=<hec-token>
SPLUNK_HEC_TIMEOUT_MS=30000
SPLUNK_HEC_ALLOW_SELF_SIGNED=true
SPLUNK_HEC_INDEX=main
SPLUNK_HEC_SOURCE=release-preflight
SPLUNK_HEC_SOURCETYPE=release_preflight:deployment
SPLUNK_HEC_HOST=<your-splunk-cloud-host>
SPLUNK_HEC_CHANNEL=<uuid-channel>

RELEASE_PREFLIGHT_AI_TOOL=saia_ask_splunk_question
RELEASE_PREFLIGHT_REQUIRE_AI=false
```

Do not prefix these with `NEXT_PUBLIC_`. They must stay server-only.

## Deploy Steps

1. Push this repo to GitHub.
2. In Vercel, import the GitHub repo.
3. Add the environment variables above.
4. Deploy.
5. Open the Vercel URL.
6. Enter a service, environment, release ID, repo, branch, and commit.
7. Click `Send marker to Splunk`.
8. Click `Run Release Preflight`.

## Splunk Usage

- Splunk HEC stores deployment events.
- Splunk MCP Server exposes Splunk tools to the app.
- `splunk_run_query` runs SPL searches against live Splunk indexes.
- The app calculates risk from the returned Splunk rows.
- The UI shows the exact SPL used for the report.

## Current Trial Caveats

- The installed Splunk MCP Server is real and active.
- HEC ingest has been verified with real `Success` responses.
- The trial tenant exposes MCP search tools, but not the Splunk AI Assistant MCP tool.
- Because of that, `RELEASE_PREFLIGHT_REQUIRE_AI=false` is the right setting for this tenant.
- Evidence is still real Splunk evidence; the deterministic narrative is only wording over Splunk-returned rows.

## Verification Commands

```bash
npm test -- --run
npm run build
```

Both must pass before deployment.
