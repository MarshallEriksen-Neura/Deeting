# Admin UI Design: Knowledge Review & Ingestion Workbench

## 1. Overview
This interface is the "Gatekeeper" for the Deeting OS knowledge ingestion pipeline. It allows administrators to review content crawled by Scout before it enters the system memory (Qdrant) or the Assistant Market.

## 0. Admin UI Scope (Today Checklist)
Below is the admin-facing functionality expected to be delivered today. Use this list as the source of truth for page coverage.

### 0.1 Assistant Management
- Create assistant
- List assistants (cursor pagination)
- Search public assistants
- Update assistant metadata
- Publish assistant (optionally switch version)
- Doc: `backend/docs/api/assistants.md`

### 0.2 Assistant Review & Tags
- Review queue list (pending/approved/rejected)
- Approve / Reject review
- Tag list / create / delete
- Doc: `backend/docs/api/assistant-reviews.md`

### 0.3 Spec Knowledge Review
- Candidate list with status filter
- Approve / Reject candidate
- Doc: `backend/docs/api/spec-knowledge.md`

### 0.4 Provider Instances (BYOP)
- Create instance
- List instances
- Sync models
- List models of an instance
- Doc: `backend/docs/api/provider_instance.md`

### 0.5 Embedding Settings (Admin)
- Get embedding settings
- Update embedding settings
- Doc: `backend/docs/api/settings.md`

### 0.6 Admin Notifications
- Send notification to a single user
- Broadcast notification to all users
- Doc: `backend/docs/api/notifications.md`

### 0.7 Registration Window & Invites
- Create registration window
- Generate invite codes under a window
- Doc: `backend/docs/api/authentication.md`

### 0.8 API Key Rate Limit (Admin)
- Update API key rate limit config
- Doc: `backend/docs/api/rate-limit.md`

## 0.9 Page Specs (UI Details)
The following sections define table columns, filters, actions, and form fields for each admin page. Use them directly for UI implementation.

### A. Assistant Management
**Route**: `/admin/assistants`

**List Table**
- Columns:
  - Name / Summary
  - Visibility (public/private)
  - Status (draft/published)
  - Current Version (version/name)
  - Share Slug
  - Rating (avg/count)
  - Install Count
  - Updated At
- Filters:
  - Status (draft/published)
  - Visibility (public/private)
  - Search (q)
  - Tags (multi)
- Actions:
  - View detail
  - Edit metadata
  - Publish (choose version)

**Create / Edit Form**
- Fields (create):
  - visibility, status, share_slug, summary, icon_id
  - version: version/name/description/system_prompt/model_config/skill_refs/tags/changelog
- Fields (edit):
  - visibility, status, share_slug, summary, icon_id, current_version_id
  - publish: version_id (optional)

**API Mapping**
- List: `GET /admin/assistants`
- Search: `GET /admin/assistants/search`
- Create: `POST /admin/assistants`
- Update: `PATCH /admin/assistants/{assistant_id}`
- Publish: `POST /admin/assistants/{assistant_id}/publish`

---

### B. Assistant Reviews & Tags
**Route**: `/admin/assistants/reviews`

**Review Queue Table**
- Columns:
  - Assistant (name/summary)
  - Submitter (user_id)
  - Status (pending/approved/rejected)
  - Tags
  - Updated At
- Filters:
  - Status
  - Tags
- Actions:
  - Approve (reason optional)
  - Reject (reason required)

**Tag Management**
- Tag List
- Create Tag
- Delete Tag

**API Mapping**
- Queue: `GET /admin/assistant-reviews`
- Approve: `POST /admin/assistant-reviews/{assistant_id}/approve`
- Reject: `POST /admin/assistant-reviews/{assistant_id}/reject`
- Tags: `GET /admin/assistant-reviews/tags`
- Create Tag: `POST /admin/assistant-reviews/tags`
- Delete Tag: `DELETE /admin/assistant-reviews/tags/{tag_id}`

---

### C. Spec Knowledge Review
**Route**: `/admin/spec-knowledge`

**Candidate Table**
- Columns:
  - Canonical Hash (short)
  - Status
  - Plan / User
  - Usage Stats (success_rate / total_runs / positive_feedback / negative_feedback)
  - Last Eval At
  - Updated At
- Filters:
  - Status
- Actions:
  - Approve (reason)
  - Reject (reason)

**API Mapping**
- List: `GET /admin/spec-knowledge-candidates`
- Approve: `POST /admin/spec-knowledge-candidates/{candidate_id}/approve`
- Reject: `POST /admin/spec-knowledge-candidates/{candidate_id}/reject`

---

### D. Provider Instances (BYOP)
**Route**: `/admin/providers/instances`

**Instance Table**
- Columns:
  - Name
  - Preset Slug
  - Base URL
  - Protocol
  - Auto Append V1
  - Priority
  - Enabled
  - Updated At
- Actions:
  - Sync Models
  - View Models

**Create Instance Form**
- Fields:
  - preset_slug, name, base_url, protocol, auto_append_v1, icon
  - api_key (optional)
  - priority, is_enabled

**Models Table (per instance)**
- Columns:
  - model_id / display_name
  - capabilities
  - upstream_path
  - source / weight / priority
  - is_active
- Action:
  - Trigger `models:sync`

**API Mapping**
- Create: `POST /admin/provider-instances`
- List: `GET /admin/provider-instances`
- Sync: `POST /admin/provider-instances/{instance_id}/models:sync`
- Models: `GET /admin/provider-instances/{instance_id}/models`

---

### E. Embedding Settings (Admin)
**Route**: `/admin/settings/embedding`

**Form**
- model_name (string)

**API Mapping**
- Get: `GET /admin/settings/embedding`
- Update: `PATCH /admin/settings/embedding`

---

### F. Notifications (Admin)
**Route**: `/admin/notifications`

**Send To User**
- Fields:
  - user_id, title, content, type, level, payload, source, dedupe_key, expires_at, tenant_id
- Action:
  - Send (POST)

**Broadcast**
- Fields:
  - title, content, type, level, payload, source, dedupe_key, expires_at, tenant_id, active_only
- Action:
  - Broadcast (POST)

**API Mapping**
- Single: `POST /admin/notifications/users/{user_id}`
- Broadcast: `POST /admin/notifications/broadcast`

---

### G. Registration Windows & Invites
**Route**: `/admin/registration`

**Window Table**
- Columns:
  - Name / Code
  - Start / End
  - Quota / Used
  - Auto Activate
  - Status
- Actions:
  - Create Window
  - View Invites

**Create Window Form**
- Fields:
  - start_at, end_at, quota, auto_activate, name(optional)

**Invites Table**
- Columns:
  - Code
  - Used / Used At
  - Created At
- Actions:
  - Generate Invite

**API Mapping**
- Create Window: `POST /admin/registration/windows`
- Generate Invites: `POST /admin/registration/windows/{id}/invites`

---

### H. API Key Rate Limit
**Route**: `/admin/api-keys/rate-limit`

**Rate Limit Form**
- Fields:
  - rpm, tpm, rpd, tpd, concurrent_limit, burst_limit, is_whitelist
- Action:
  - Update (PUT)

**API Mapping**
- Update: `PUT /admin/api-keys/{id}/rate-limit`

## 2. Page Structure
**Route**: `/admin/knowledge/reviews`

### 2.1 The Review Queue (Data Table)
A list of `KnowledgeArtifact` items with `status="pending_review"`.

| Column | Description |
| :--- | :--- |
| **Source** | URL + Domain Icon |
| **Title** | Page Title |
| **Type** | `Documentation` / `Assistant` / `Provider` |
| **Stats** | Size (Chars), Images count, Depth |
| **Captured At** | Timestamp |
| **Actions** | [Preview] [Approve] [Convert] [Reject] |

### 2.2 Content Preview (Modal / Drawer)
When clicking **[Preview]**, open a side drawer showing the raw Markdown.
*   **Safety Highlight**: Highlight potentially sensitive keywords in yellow.
*   **Metadata**: Show `embedding_model` intended for this content.

### 2.3 Action Logic

#### A. ✅ Approve (Index to System RAG)
*   **Trigger API**: `POST /api/v1/ingest/reviews/{id}/approve`
*   **Behavior**:
    1.  Update status to `processing`.
    2.  Trigger Celery Task -> Chunking -> Embedding -> Qdrant (`kb_system`).
*   **Use Case**: Official documentation, technical manuals.

#### B. 🤖 Convert to Assistant (AI Refinery)
*   **Trigger API**: `POST /api/v1/ingest/reviews/{id}/convert-to-assistant`
*   **UI Feedback**: Show a "Refining..." spinner (may take 5-10s).
*   **Behavior**:
    1.  Backend calls LLM to extract Persona/Prompt from Markdown.
    2.  Creates a new `Assistant` (published, public), default scope is `user`.
    3.  If admin explicitly selects `target_scope=system`, assistant is stored as system-level (`owner_user_id = null`).
    4.  Expert index sync follows market rules: system assistants sync directly; user assistants sync only after review approved.
*   **Result**: "New Assistant 'Python Guru' created! [View in Market]"
*   **Use Case**: "Awesome ChatGPT Prompts" pages, Character descriptions.

#### C. ❌ Reject (Delete)
*   **Trigger API**: `POST /api/v1/ingest/reviews/{id}/reject`
*   **Behavior**: Hard delete the artifact from PostgreSQL.

## 3. Integration with ChatOps
This UI is optional if the admin prefers **ChatOps**.
The `Integration Specialist` agent can perform these actions via tools:
*   `list_pending_reviews()`
*   `approve_artifact(id)`
*   `convert_artifact_to_assistant(id)`

## 4. Future Enhancements
*   **Bulk Actions**: Select multiple docs to approve at once.
*   **Edit before Approve**: Allow admin to modify the Markdown text (e.g., remove footer) before indexing.
