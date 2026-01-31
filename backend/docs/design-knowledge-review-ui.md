# Admin UI Design: Knowledge Review & Ingestion Workbench

## 1. Overview
This interface is the "Gatekeeper" for the Deeting OS knowledge ingestion pipeline. It allows administrators to review content crawled by Scout before it enters the system memory (Qdrant) or the Assistant Market.

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
    2.  Creates a new `Assistant` (published, public).
    3.  Auto-indexes to `expert_network` collection.
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
