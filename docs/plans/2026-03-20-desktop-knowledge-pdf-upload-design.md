# Desktop Knowledge PDF Upload Design

**Lane:** `desktop local`

## Goal

Allow the desktop knowledge upload flow to accept text-based PDF files and ingest them into the existing local knowledge pipeline.

## Current Boundary

- The dashboard upload UI already knows about `pdf` as a file type in shared knowledge types.
- The desktop-local upload path intentionally excludes `pdf` from its local whitelist.
- Local ingestion does not parse files inside Tauri. It stores extracted text in `user_document.meta_info.raw_text`, then Tauri chunks that text into `knowledge_chunk`.

## Proposed Approach

Use browser-side PDF text extraction in the desktop frontend upload path, matching the existing `docx` approach:

1. Add a frontend PDF text extraction utility.
2. Extend desktop-local upload whitelists to include `pdf`.
3. When a local PDF is uploaded, extract text in the frontend and pass it as `meta_info.raw_text` to `create_local_user_document`.
4. Keep the Tauri knowledge store unchanged so it continues to chunk `raw_text` and update document status.

## Why This Approach

- It preserves the current source of truth for desktop-local ingestion: extracted text, not raw file parsing inside Tauri.
- It avoids expanding Rust/Tauri parsing dependencies for this small feature.
- It keeps the remote/cloud upload path and backend document APIs unchanged.

## Explicit Non-Goals

- OCR for scanned/image-only PDFs
- Changing local storage semantics for raw files
- Refactoring Tauri knowledge storage or chunking
- Unifying desktop-local and cloud document parsing stacks

## Risks

- Some PDFs contain little or no extractable text. Those should surface as normal local processing failures if extraction yields empty content.
- Browser-side PDF parsing can require worker configuration. The chosen implementation must support a worker-free or inline-worker path compatible with Tauri desktop runtime.
