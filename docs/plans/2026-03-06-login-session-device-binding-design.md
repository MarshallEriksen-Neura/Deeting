# Login Session Device Binding Design

## Context

Current device management is only partially bound to authentication state:

- `login_session` stores a single refresh-token JTI plus device metadata.
- Profile device revocation only marks the DB row revoked, but does not fully invalidate the device session.
- Access tokens are not tied to a stable device-session identifier.
- OAuth login paths issue tokens without consistently registering them into profile-manageable device sessions.

Because the project is still in development and has no production users yet, we can adopt a clean model without backward-compatibility shims.

## Goals

- Make each login device/session a first-class stable record.
- Bind both access and refresh tokens to that stable session.
- Ensure profile device revocation immediately disables both access and refresh for that device.
- Include email-code login and OAuth login in the same device-management model.

## Chosen Approach

Use a stable `login_session` row as the source of truth for one device login session.

### Data model

Extend `login_session` to track:

- `session_key`: stable session identifier embedded in JWT as `sid`
- `current_access_jti`: latest access-token JTI for the session
- `current_refresh_jti`: latest refresh-token JTI for the session

The previous `refresh_token_jti` column is renamed to `current_refresh_jti` for clarity.

### Token model

All newly issued tokens must include:

- `jti`
- `type`
- `version`
- `sid`

This applies to:

- email-code login
- refresh rotation
- desktop OAuth exchange
- LinuxDo OAuth callback

### Runtime rules

#### Login

- Create `session_key`
- Issue access and refresh tokens with `sid=session_key`
- Create `login_session` row with current token JTIs and device metadata

#### Refresh

- Decode refresh token and require `sid`
- Validate Redis refresh record
- Load `login_session` by `session_key`
- Require session to be active and token JTI to match `current_refresh_jti`
- Rotate tokens and update the same `login_session` row with new JTIs

#### Access authentication

- Keep blacklist check and token-version check
- Additionally require `sid` to map to an active `login_session`
- If the session is revoked, reject the request immediately

#### Profile device revocation

When revoking a non-current device:

- set `revoked_at`
- delete the current refresh token from Redis
- blacklist the current access token

This guarantees immediate device sign-out.

#### Logout

Current-device logout uses the same invalidation semantics for the current session.

## API behavior

### `GET /api/v1/login-sessions`

- Returns active device sessions
- `is_current` is computed using the refresh cookie token and stable session identity

### `DELETE /api/v1/login-sessions/{id}`

- Rejects revoking the current device from this endpoint
- Fully invalidates the target device session

## Testing plan

- login creates a bound `login_session`
- OAuth login creates a bound `login_session`
- refresh updates the existing session instead of creating a new one
- revoked device cannot refresh
- revoked device cannot access protected endpoints with its existing access token
- current device remains protected from self-revocation via profile endpoint

## File scope

Primary backend changes are expected in:

- `backend/app/models/login_session.py`
- `backend/app/services/users/login_session_service.py`
- `backend/app/services/users/auth_service.py`
- `backend/app/services/users/desktop_oauth_service.py`
- `backend/app/api/v1/auth_route.py`
- `backend/app/api/v1/endpoints/login_sessions.py`
- `backend/app/deps/auth.py`
- `backend/app/utils/security.py`
- `backend/migrations/versions/*`
- `backend/tests/api/test_auth.py`
- `backend/tests/api/test_oauth_google_github_desktop.py`

## Notes

- No compatibility layer is needed because the project has no live users yet.
- Per higher-priority CLI instructions, this design doc is not committed automatically.
