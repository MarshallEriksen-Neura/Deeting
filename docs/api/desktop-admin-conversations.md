# Desktop Admin Conversations API
Updated: 2026-03-03

## Scope
- This document describes desktop (Tauri) local admin conversation commands.
- It covers admin conversation query and status operations only.

## Tauri Commands
### 1) `list_local_admin_conversations`
- Request:
```json
{
  "query": {
    "skip": 0,
    "limit": 100,
    "status": "active | closed | archived | null",
    "channel": "internal | external | null",
    "user_id": "uuid | null",
    "assistant_id": "uuid | null",
    "start_time": "RFC3339 | null",
    "end_time": "RFC3339 | null"
  }
}
```
- Response:
```json
{
  "total": 1,
  "skip": 0,
  "limit": 100,
  "items": [
    {
      "id": "session-id",
      "title": "string | null",
      "user_id": "uuid | null",
      "assistant_id": "uuid | null",
      "channel": "internal | external",
      "status": "active | closed | archived",
      "message_count": 0,
      "first_message_at": "RFC3339 | null",
      "last_active_at": "RFC3339 | null",
      "last_summary_version": 0,
      "created_at": "RFC3339 | null",
      "updated_at": "RFC3339 | null"
    }
  ]
}
```
- Notes:
  - `user_id = null`: no user filter.
  - `user_id != null`: exact match on session `user_id`.
  - `assistant_id = null`: no assistant filter.
  - `start_time/end_time`: filter by `last_active_at` (inclusive).

### 2) `get_local_admin_conversation`
- Request:
```json
{ "session_id": "uuid" }
```
- Response:
```json
{
  "id": "session-id",
  "title": "string | null",
  "user_id": "uuid | null",
  "assistant_id": "uuid | null",
  "channel": "internal | external",
  "status": "active | closed | archived",
  "message_count": 0,
  "first_message_at": "RFC3339 | null",
  "last_active_at": "RFC3339 | null",
  "last_summary_version": 0,
  "created_at": "RFC3339 | null",
  "updated_at": "RFC3339 | null"
}
```

### 3) `archive_local_conversation`
- Request:
```json
{ "session_id": "uuid" }
```
- Response:
```json
{ "session_id": "uuid", "status": "archived" }
```

### 4) `close_local_conversation`
- Request:
```json
{ "session_id": "uuid" }
```
- Response:
```json
{ "session_id": "uuid", "status": "closed" }
```

## Admin Page Default Behavior
- Conversation admin page defaults to "Current User" scope.
- User can switch to "All Users" scope.
- Query mapping:
  - Current User: send `user_id=<current_user_id>`
  - All Users: do not send `user_id`
