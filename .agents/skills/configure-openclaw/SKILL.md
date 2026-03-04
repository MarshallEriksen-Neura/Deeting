---
name: configure-openclaw
description: Configure OpenClaw notification gateway via natural language
triggers:
  - "configure openclaw"
  - "setup openclaw"
  - "openclaw notifications"
  - "openclaw gateway"
---

# Configure OpenClaw Notifications

Set up OpenClaw as a notification gateway so OMX can route notification events to your OpenClaw hook endpoints (or a local command gateway).

## Runtime Schema Requirement (must match OMX)

Always write OpenClaw config under:
- `notifications.openclaw.enabled`
- `notifications.openclaw.gateways`
- `notifications.openclaw.hooks`

Do **not** use legacy keys like `gatewayType`, `endpoint`, or top-level `command`.

## How This Skill Works

This is an interactive setup wizard. Ask questions with AskUserQuestion, merge changes into `~/.codex/.omx-config.json`, and then run a verification flow with explicit pass/fail diagnostics.

## Step 1: Detect Existing OpenClaw Configuration

```bash
CONFIG_FILE="$HOME/.codex/.omx-config.json"

if [ -f "$CONFIG_FILE" ]; then
  OPENCLAW_ENABLED=$(jq -r '.notifications.openclaw.enabled // false' "$CONFIG_FILE" 2>/dev/null)
  GATEWAYS=$(jq -r '.notifications.openclaw.gateways // {} | keys | join(", ")' "$CONFIG_FILE" 2>/dev/null)
  HOOKS=$(jq -r '.notifications.openclaw.hooks // {} | keys | join(", ")' "$CONFIG_FILE" 2>/dev/null)

  echo "OPENCLAW_ENABLED=$OPENCLAW_ENABLED"
  echo "GATEWAYS=${GATEWAYS:-none}"
  echo "HOOKS=${HOOKS:-none}"
else
  echo "NO_CONFIG_FILE"
fi
```

If existing config is found, show current gateways/hooks and ask whether to update or replace.

## Step 2: Choose Gateway Mode

Use AskUserQuestion:

**Question:** "Which OpenClaw gateway mode do you want to configure?"

**Options:**
1. **HTTP Gateway (Recommended)** - OMX POSTs JSON to your OpenClaw hook endpoint
2. **CLI Command Gateway** - OMX executes a local command template

## Step 3A: HTTP Gateway Setup

Collect three values:
1. Gateway name (default: `local`)
2. Hook base URL (example: `http://127.0.0.1:18789`)
3. OpenClaw hooks token

Build the endpoint URL as:
- Delivery endpoint: `${BASE_URL%/}/hooks/agent`
- Optional wake smoke endpoint: `${BASE_URL%/}/hooks/wake`

### Required validation checks

Run these checks and report each result:

1) **Hook token present**
```bash
[ -n "$HOOKS_TOKEN" ] && echo "PASS token provided" || echo "FAIL token missing"
```

2) **Gateway URL format and reachability**
```bash
case "$BASE_URL" in
  http://*|https://*) echo "PASS URL format" ;;
  *) echo "FAIL URL must start with http:// or https://" ;;
esac

curl -sS -o /dev/null -w "HTTP %{http_code}\n" "$BASE_URL" || echo "FAIL cannot reach base URL"
```

3) **Delivery endpoint probe (`/hooks/agent`)**
```bash
curl -sS -o /tmp/omx-openclaw-agent.json -w "HTTP %{http_code}\n" \
  -X POST "${BASE_URL%/}/hooks/agent" \
  -H "Authorization: Bearer $HOOKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"instruction":"OMX OpenClaw setup probe","event":"session-end","sessionId":"setup-smoke"}'
```

If probe is non-2xx or network fails, treat as setup failure and continue with diagnostics.

## Step 3B: CLI Command Gateway Setup

Collect:
- Gateway name (default: `local-command`)
- Command template (supports `{{event}}`, `{{instruction}}`, `{{sessionId}}`, `{{projectPath}}`)

Example:
```bash
~/.local/bin/my-notifier --event {{event}} --text {{instruction}}
```

### Dual env gate (must be explained)

CLI command gateways only run when **both** are set:

```bash
export OMX_OPENCLAW=1
export OMX_OPENCLAW_COMMAND=1
```

If `OMX_OPENCLAW_COMMAND` is missing, command gateway dispatch is blocked by design.

## Step 4: Select Hook Event Mappings

Use AskUserQuestion with multiSelect.

**Question:** "Which OMX events should trigger OpenClaw hooks?"

Recommended defaults:
- `session-end`
- `ask-user-question`

Optional:
- `session-start`
- `session-idle`
- `stop`

For each selected event, collect a short instruction template.

## Step 5: Write Schema-Aligned Config

Always merge into `~/.codex/.omx-config.json`.

### HTTP gateway example

```bash
jq \
  --arg gatewayName "$GATEWAY_NAME" \
  --arg url "${BASE_URL%/}/hooks/agent" \
  --arg token "$HOOKS_TOKEN" \
  '.notifications = (.notifications // {enabled: true}) |
   .notifications.enabled = true |
   .notifications.openclaw = (.notifications.openclaw // {}) |
   .notifications.openclaw.enabled = true |
   .notifications.openclaw.gateways = (.notifications.openclaw.gateways // {}) |
   .notifications.openclaw.gateways[$gatewayName] = {
     type: "http",
     url: $url,
     headers: {"Authorization": ("Bearer " + $token)}
   }' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
```

### Command gateway example

```bash
jq \
  --arg gatewayName "$GATEWAY_NAME" \
  --arg command "$COMMAND_TEMPLATE" \
  '.notifications = (.notifications // {enabled: true}) |
   .notifications.enabled = true |
   .notifications.openclaw = (.notifications.openclaw // {}) |
   .notifications.openclaw.enabled = true |
   .notifications.openclaw.gateways = (.notifications.openclaw.gateways // {}) |
   .notifications.openclaw.gateways[$gatewayName] = {
     type: "command",
     command: $command
   }' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
```

### Hook mapping example

```bash
jq \
  --arg gatewayName "$GATEWAY_NAME" \
  '.notifications.openclaw.hooks = (.notifications.openclaw.hooks // {}) |
   .notifications.openclaw.hooks["session-end"] = {
     enabled: true,
     gateway: $gatewayName,
     instruction: "OMX task completed for {{projectPath}}"
   } |
   .notifications.openclaw.hooks["ask-user-question"] = {
     enabled: true,
     gateway: $gatewayName,
     instruction: "OMX needs input: {{question}}"
   }' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
```

## Step 6: Explain Activation Gates

Show this exactly:

```bash
# Required for OpenClaw integration
export OMX_OPENCLAW=1

# Required in addition for command gateways
export OMX_OPENCLAW_COMMAND=1
```

## Step 7: Verification Flow (required)

Run both checks for HTTP gateways:

### A) Wake smoke test (`/hooks/wake`)

```bash
curl -sS -X POST "${BASE_URL%/}/hooks/wake" \
  -H "Authorization: Bearer $HOOKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"OMX wake smoke test","mode":"now"}'
```

Expected pass signal: JSON includes `"ok":true`.

### B) Delivery verification (`/hooks/agent`) — not wake-only

```bash
curl -sS -o /tmp/omx-openclaw-delivery.json -w "HTTP %{http_code}\n" \
  -X POST "${BASE_URL%/}/hooks/agent" \
  -H "Authorization: Bearer $HOOKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"instruction":"OMX delivery verification","event":"session-end","sessionId":"verify-setup"}'
```

Expected pass signal: HTTP 2xx and response body confirms acceptance.

## Step 8: Pass/Fail Diagnostics Guidance

If verification fails, guide with this checklist:
- **401/403** → token missing/invalid; rotate token and update `Authorization` header.
- **404** → wrong path; verify `/hooks/agent` and `/hooks/wake` are enabled by OpenClaw hooks config.
- **5xx** → OpenClaw gateway runtime issue; check gateway logs and retry.
- **Timeout / connection refused** → gateway URL unreachable; confirm host/port and local firewall.
- **Command gateway disabled** → set both `OMX_OPENCLAW=1` and `OMX_OPENCLAW_COMMAND=1`.

## Step 9: Final Summary

Show:
- gateway mode + gateway name
- mapped events
- whether smoke test passed
- whether `/hooks/agent` delivery test passed
- exact env vars user still needs to export in shell profile

## Environment Variable Reference

```bash
# Required for all OpenClaw gateways
export OMX_OPENCLAW=1

# Required additionally for CLI command gateways
export OMX_OPENCLAW_COMMAND=1

# Optional debug logs
export OMX_OPENCLAW_DEBUG=1
```
