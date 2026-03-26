# Desktop Local Telegram Private Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add desktop-local Telegram private-bot support on top of the existing Telegram notification channel so one Telegram configuration can power both active push notifications and direct private-chat replies.

**Architecture:** Reuse the existing local notification-channel record as the single source of truth. Keep active push inside the monitor module, then extend desktop IM runtime to derive Telegram direct profiles from that same channel record and run a Telegram long-polling worker that only accepts private text messages.

**Tech Stack:** Rust/Tauri, reqwest, tokio, Next.js App Router, TypeScript, Zustand/SWR

---

### Task 1: Add Telegram IM configuration to the shared notification-channel contract

**Files:**
- Modify: `deeting/lib/api/notification-channels.ts`
- Modify: `deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx`
- Test: `deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx`

**Step 1: Write the failing test**

Add or extend a UI-level test near the notification-channel form so Telegram config preserves `im_enabled` and renders Telegram-specific guidance for private bot usage.

```tsx
it("keeps telegram im_enabled and explains bot_token versus chat_id usage", async () => {
  expect(true).toBe(false)
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand notification-channels`

Expected: FAIL because Telegram IM fields and messaging are not wired into the form yet.

**Step 3: Write minimal implementation**

- Add `im_enabled?: boolean` to Telegram config typing in `deeting/lib/api/notification-channels.ts`
- Add a Telegram `im_enabled` switch field to `deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx`
- Update Telegram helper text so users know:
  - `bot_token` is shared by push + private bot
  - `chat_id` is push-only

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand notification-channels`

Expected: PASS for the Telegram form behavior you added or updated.

**Step 5: Commit**

```bash
git add deeting/lib/api/notification-channels.ts deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx
git commit -m "feat: add telegram desktop im channel config"
```

### Task 2: Derive Telegram IM profiles from local notification channels

**Files:**
- Modify: `deeting/src-tauri/src/modules/im/profile.rs`
- Modify: `deeting/src-tauri/src/modules/im/runtime.rs`
- Test: `deeting/src-tauri/src/modules/im/profile.rs`
- Test: `deeting/src-tauri/src/modules/im/runtime.rs`

**Step 1: Write the failing test**

Add Rust tests that prove:

- a Telegram notification channel with `im_enabled=true` and `bot_token` derives a Telegram profile
- a Telegram profile resolves to direct transport when the token is present

```rust
#[test]
fn telegram_profile_with_token_supports_direct_transport() {
    assert!(false, "telegram profile derivation not implemented");
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml telegram_profile`

Expected: FAIL because Telegram profile derivation from notification channels does not exist yet.

**Step 3: Write minimal implementation**

- Add a Telegram default profile helper in `deeting/src-tauri/src/modules/im/profile.rs`
- Extend `deeting/src-tauri/src/modules/im/runtime.rs` so notification channels can derive both Feishu and Telegram profiles
- For Telegram:
  - use `platform = ImPlatform::Telegram`
  - use `direct_config.telegram_bot_token`
  - gate enablement on `channel.is_active && im_enabled`
  - do not create relay-only behavior

**Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml telegram_profile`

Expected: PASS for Telegram profile derivation and transport resolution.

**Step 5: Commit**

```bash
git add deeting/src-tauri/src/modules/im/profile.rs deeting/src-tauri/src/modules/im/runtime.rs
git commit -m "feat: derive telegram desktop im profiles"
```

### Task 3: Run Telegram private-message worker through desktop IM runtime

**Files:**
- Modify: `deeting/src-tauri/src/modules/im/runtime.rs`
- Modify: `deeting/src-tauri/src/modules/im/telegram/client.rs`
- Test: `deeting/src-tauri/src/modules/im/runtime.rs`
- Test: `deeting/src-tauri/src/modules/im/telegram/client.rs`

**Step 1: Write the failing test**

Add tests that prove the Telegram runtime worker:

- accepts `private` text messages
- ignores non-private messages for the first release
- returns a readable error when polling cannot operate

```rust
#[test]
fn telegram_worker_ignores_non_private_messages() {
    assert!(false, "telegram runtime worker not implemented");
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml telegram_worker`

Expected: FAIL because Telegram runtime worker behavior is missing.

**Step 3: Write minimal implementation**

- Add a Telegram worker path to `deeting/src-tauri/src/modules/im/runtime.rs`
- Reuse the same local-chat reply flow already used by Feishu
- Only handle:
  - `ImEvent::Message`
  - `platform == Telegram`
  - `chat_type == ChatType::Private`
  - `MessageContent::Text`
- Ignore group/channel messages in the worker
- Surface a clearer runtime error when Telegram cannot poll successfully

**Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml telegram_worker`

Expected: PASS for Telegram private-message worker behavior.

**Step 5: Commit**

```bash
git add deeting/src-tauri/src/modules/im/runtime.rs deeting/src-tauri/src/modules/im/telegram/client.rs
git commit -m "feat: add telegram desktop private bot runtime"
```

### Task 4: Surface Telegram desktop IM runtime state in the UI

**Files:**
- Modify: `deeting/lib/api/desktop-im.ts`
- Modify: `deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx`
- Test: `deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx`

**Step 1: Write the failing test**

Add a UI test that proves the notification-channel screen can show a Telegram IM runtime hint, rather than only a Feishu-specific hint.

```tsx
it("shows telegram runtime status from desktop im snapshot", async () => {
  expect(true).toBe(false)
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand notification-channels`

Expected: FAIL because Telegram runtime status helpers are not exposed yet.

**Step 3: Write minimal implementation**

- Generalize the helper shape in `deeting/lib/api/desktop-im.ts` so Telegram resolution can be queried alongside Feishu
- Update `deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx` to render Telegram runtime hints when editing a Telegram channel
- Keep the UX honest:
  - distinguish configured vs operational
  - explain when the bot is disabled, missing token, or unavailable

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand notification-channels`

Expected: PASS for Telegram runtime status rendering.

**Step 5: Commit**

```bash
git add deeting/lib/api/desktop-im.ts deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx
git commit -m "feat: show telegram desktop im runtime status"
```

### Task 5: Verify end-to-end desktop-local Telegram behavior

**Files:**
- Verify only: `deeting/src-tauri/src/modules/im/runtime.rs`
- Verify only: `deeting/src-tauri/src/modules/monitor/mod.rs`
- Verify only: `deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx`

**Step 1: Run targeted Rust tests**

Run: `cargo test --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml telegram`

Expected: PASS for new Telegram profile/runtime coverage.

**Step 2: Run targeted web tests**

Run: `npm test -- --runInBand notification-channels`

Expected: PASS for Telegram form and runtime-status coverage.

**Step 3: Run a desktop build-level sanity check**

Run: `cargo check --manifest-path /data/Deeting/deeting/src-tauri/Cargo.toml`

Expected: PASS with no new Telegram-related compile errors.

**Step 4: Manually validate the product contract**

Verify in a desktop run:

- Telegram channel saves `bot_token`, `chat_id`, and `im_enabled`
- active push still works with `chat_id`
- private text message to the bot produces a local reply
- group messages do not trigger replies

**Step 5: Commit**

```bash
git add deeting/src-tauri/src/modules/im/runtime.rs deeting/src-tauri/src/modules/im/profile.rs deeting/src-tauri/src/modules/im/telegram/client.rs deeting/lib/api/notification-channels.ts deeting/lib/api/desktop-im.ts deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx
git commit -m "feat: wire telegram desktop private bot through notification channels"
```
