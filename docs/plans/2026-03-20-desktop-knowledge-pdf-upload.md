# Desktop Knowledge PDF Upload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable desktop-local knowledge uploads to accept text-based PDF files and ingest them through the existing `raw_text` local knowledge pipeline.

**Architecture:** Keep the existing desktop-local seam intact: frontend extracts document text, then sends `meta_info.raw_text` through `create_local_user_document`, and Tauri continues chunking/storing that text. Do not move PDF parsing into Rust or change cloud upload behavior.

**Tech Stack:** Next.js/React, Jest, Tauri desktop bridge, browser-side PDF parsing library

---

### Task 1: Lock the intended PDF behavior with tests

**Files:**
- Modify: `deeting/lib/api/__tests__/knowledge.test.ts`

**Step 1: Write the failing test**

Add coverage for:
- desktop-local upload affordances including `pdf`
- desktop-local PDF upload calling `create_local_user_document` with `meta_info.file_type = "pdf"` and extracted `raw_text`

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand deeting/lib/api/__tests__/knowledge.test.ts`

Expected: FAIL because desktop-local types still reject `pdf` or PDF extraction is missing.

**Step 3: Write minimal implementation**

Update local upload logic to accept `pdf` and extract its text before creating the local document.

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand deeting/lib/api/__tests__/knowledge.test.ts`

Expected: PASS

### Task 2: Add a browser-side PDF text extraction utility

**Files:**
- Create: `deeting/lib/utils/pdf.ts`
- Modify: `deeting/package.json`

**Step 1: Write the failing test**

If needed, add utility-focused coverage for the extraction helper.

**Step 2: Run test to verify it fails**

Run the same focused Jest command or a utility-specific test command.

Expected: FAIL because the helper or dependency does not exist yet.

**Step 3: Write minimal implementation**

Use an official browser-capable PDF parsing library to:
- load PDF bytes from `File`
- iterate pages
- collect text items
- join them into normalized plain text

**Step 4: Run test to verify it passes**

Run the focused Jest command again.

Expected: PASS

### Task 3: Wire PDF extraction into desktop-local knowledge upload

**Files:**
- Modify: `deeting/lib/api/knowledge.ts`

**Step 1: Write the failing test**

Use the PDF upload test from Task 1 as the red case.

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand deeting/lib/api/__tests__/knowledge.test.ts`

Expected: FAIL with unsupported type or missing extraction behavior.

**Step 3: Write minimal implementation**

- Add `pdf` to `LOCAL_UPLOAD_FILE_TYPES`
- Update local text-reading logic to call the new PDF extractor
- Keep existing size limits and object-storage upload behavior

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand deeting/lib/api/__tests__/knowledge.test.ts`

Expected: PASS

### Task 4: Verify the exact closure boundary

**Files:**
- Review only: `deeting/src-tauri/src/modules/knowledge/store.rs`

**Step 1: Run focused verification**

Run:
- `npm test -- --runInBand deeting/lib/api/__tests__/knowledge.test.ts`
- `npm test -- --runInBand deeting/lib/utils/__tests__/docx.test.ts` if shared binary utility assumptions changed

**Step 2: Confirm no architectural drift**

Verify that Tauri still chunks only extracted text from `meta_info` and that no Rust-side PDF parsing was introduced.

**Step 3: Report residual risk**

Document that scanned PDFs without extractable text remain unsupported unless OCR is added later.
