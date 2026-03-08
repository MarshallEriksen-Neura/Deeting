# Desktop Feishu Relay Architecture

## Overview

Deeting desktop does not expose Feishu callback endpoints directly.

The intended integration boundary is:

`Feishu Open Platform -> deeting-relay -> Deeting desktop (Tauri) -> deeting-relay -> Feishu Open Platform`

This split exists for three reasons:

- Feishu event subscription and card interaction callbacks are public-ingress concerns.
- Feishu bot credentials and callback verification secrets should stay on a deployable server boundary, not inside a distributed desktop client.
- Desktop-local execution may exceed Feishu callback timing limits, so relay must acknowledge or coordinate responses independently of local execution time.

## Responsibility Split

### `deeting-relay`

`deeting-relay` is the public Feishu ingress and response coordinator.

It is responsible for:

- receiving Feishu event subscription traffic
- receiving Feishu card interaction callbacks
- validating callback authenticity and URL verification handshakes
- holding `FEISHU_BOT_APP_ID`, `FEISHU_BOT_APP_SECRET`, and callback verification settings
- forwarding normalized events to desktop agents
- sending bot replies or card updates back to Feishu

### Desktop Tauri runtime

The desktop app is a private execution client.

It is responsible for:

- registering itself with relay
- polling relay for normalized Feishu work items
- executing local orchestration, tools, or monitor actions
- returning structured execution results to relay

It is not responsible for:

- exposing public Feishu callback URLs
- storing Feishu app credentials
- acting as the canonical ingress surface for Feishu traffic

### Backend monitor Feishu endpoints

The backend endpoints documented in `docs/api/monitor.md` are cloud/backend contracts:

- `POST /api/v1/monitors/feishu/callback`
- `POST /api/v1/monitors/feishu/events`

They describe the backend Feishu integration path and should not be interpreted as desktop-local endpoints.

## Current Repository State

As of the current implementation:

- desktop local monitor support includes outbound Feishu webhook notifications only
- desktop relay support includes polling relay for Feishu chat events and structured Feishu card-action events
- relay currently accepts `POST /feishu/events` for message events and `POST /feishu/card/callback` for card interaction callbacks
- desktop currently responds to a first batch of card actions through toast responses, with monitor-oriented actions mapped to local handlers
- delayed card update and richer card rendering flows remain follow-up work

Relevant code:

- `deeting/src-tauri/src/modules/monitor/mod.rs`
- `deeting/src-tauri/src/modules/relay/mod.rs`
- `deeting-relay/main.go`
- `backend/app/api/v1/monitor_route.py`

## Design Rules For Future Work

- Do not add Feishu public callback endpoints to the Tauri app.
- Do not move Feishu bot secrets into desktop settings.
- Keep one routing authority for any Feishu-triggered action to avoid cloud and desktop double execution.
- Normalize Feishu events once at relay when possible, rather than duplicating parsing semantics in both relay and desktop.
- Treat card callbacks as asynchronous desktop work coordinated by relay, not as direct synchronous desktop HTTP handling.
