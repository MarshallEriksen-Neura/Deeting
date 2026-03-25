# Backend Submodule Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the current `backend/` history while converting it from a monorepo directory into a Git submodule backed by `https://github.com/MarshallEriksen-Neura/deeting_core.git`.

**Architecture:** Split the existing monorepo history for `backend/` into a standalone branch, push that branch to the new remote as its initial history, then replace the root-tracked `backend/` tree with a submodule entry at the same path. Protect existing uncommitted work before destructive git operations, then verify that the root repo and nested repo both resolve to the expected remotes and commits.

**Tech Stack:** Git, Git subtree history split, Git submodules, shell verification

---

### Task 1: Protect current workspace state

**Files:**
- Modify: root Git index and stash state

**Step 1: Inspect current root status**

Run: `git status --short`
Expected: Shows any tracked and untracked work that must survive migration.

**Step 2: Create a safety stash for root changes**

Run: `git stash push -u -m "pre-backend-submodule-migration"`
Expected: Working tree becomes clean enough for the migration steps.

**Step 3: Confirm the safety point exists**

Run: `git stash list | head`
Expected: Includes `pre-backend-submodule-migration`.

### Task 2: Split backend history into a standalone branch

**Files:**
- Source: `backend/`

**Step 1: Generate a subtree history branch**

Run: `git subtree split --prefix=backend -b backend-split`
Expected: Returns a commit SHA for the standalone backend history.

**Step 2: Inspect the split branch**

Run: `git log --oneline -n 5 backend-split`
Expected: Shows backend-only history.

### Task 3: Seed the new remote repository

**Files:**
- Remote repo: `MarshallEriksen-Neura/deeting_core`

**Step 1: Add a temporary remote**

Run: `git remote add backend-core https://github.com/MarshallEriksen-Neura/deeting_core.git`
Expected: Remote is available for push.

**Step 2: Push the split branch as the remote default branch**

Run: `git push backend-core backend-split:main`
Expected: Remote now has an initial `main` history.

**Step 3: Verify the remote head**

Run: `git ls-remote --heads backend-core`
Expected: Includes `refs/heads/main`.

### Task 4: Replace the tracked directory with a submodule

**Files:**
- Modify: `.gitmodules`
- Modify: root Git index entry for `backend`

**Step 1: Remove the root-tracked backend tree from the index**

Run: `git rm -r --cached backend`
Expected: Root repo stops tracking the directory contents.

**Step 2: Remove the working tree copy before submodule checkout**

Run: `rm -rf backend`
Expected: Path is free for submodule creation.

**Step 3: Add the new submodule**

Run: `git submodule add -b main https://github.com/MarshallEriksen-Neura/deeting_core.git backend`
Expected: `backend/` is re-created as a submodule and `.gitmodules` is updated.

**Step 4: Rehydrate any stashed local edits**

Run: `git stash pop`
Expected: Non-backend local work is restored; backend-specific edits are either restored inside the submodule or reported for manual resolution.

### Task 5: Verify the migration state

**Files:**
- Verify: `.gitmodules`
- Verify: `backend/.git` or submodule gitdir wiring

**Step 1: Inspect the new root status**

Run: `git status --short && git submodule status`
Expected: Shows `.gitmodules` and the `backend` gitlink change, plus any restored unrelated local work.

**Step 2: Verify the nested repo remote**

Run: `git -C backend remote -v`
Expected: `origin` points to `https://github.com/MarshallEriksen-Neura/deeting_core.git`.

**Step 3: Verify the nested repo HEAD**

Run: `git -C backend log --oneline -n 3`
Expected: Shows the migrated backend history.
