use serde::Serialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_SELECTION_BYTES: usize = 200 * 1024;
const COPY_FALLBACK_DELAY_MS: u64 = 150;
const MODIFIER_RELEASE_TIMEOUT_MS: u64 = 450;
#[cfg(target_os = "linux")]
const AT_SPI_CAPTURE_TIMEOUT_MS: u64 = 900;
#[cfg(target_os = "linux")]
const AT_SPI_MAX_TRAVERSAL_NODES: usize = 600;
#[cfg(target_os = "linux")]
const AT_SPI_MAX_CHILDREN_PER_NODE: usize = 80;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SelectionCaptureSource {
    Accessibility,
    ClipboardFallback,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionCaptureDiagnostics {
    pub native_available: bool,
    pub clipboard_fallback_attempted: bool,
    pub clipboard_restored: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionCaptureResult {
    pub selection_id: String,
    pub text: String,
    pub source: SelectionCaptureSource,
    pub captured_at: i64,
    pub char_count: usize,
    pub truncated: bool,
    pub diagnostics: SelectionCaptureDiagnostics,
}

struct RawCapture {
    text: String,
    source: SelectionCaptureSource,
    native_available: bool,
    clipboard_fallback_attempted: bool,
    clipboard_restored: bool,
    error: Option<String>,
}

pub fn capture_active_selection() -> SelectionCaptureResult {
    normalize_capture(capture_raw_selection())
}

pub fn unavailable_capture_result(error: impl Into<String>) -> SelectionCaptureResult {
    normalize_capture(RawCapture {
        text: String::new(),
        source: SelectionCaptureSource::Unavailable,
        native_available: false,
        clipboard_fallback_attempted: false,
        clipboard_restored: false,
        error: Some(error.into()),
    })
}

fn capture_raw_selection() -> RawCapture {
    if let Some(text) = read_accessibility_selected_text() {
        return RawCapture {
            text,
            source: SelectionCaptureSource::Accessibility,
            native_available: true,
            clipboard_fallback_attempted: false,
            clipboard_restored: false,
            error: None,
        };
    }

    capture_from_clipboard_fallback()
}

fn normalize_capture(raw: RawCapture) -> SelectionCaptureResult {
    let trimmed = raw.text.trim().to_string();
    let (text, truncated) = truncate_to_max_bytes(&trimmed, MAX_SELECTION_BYTES);
    let source = if text.is_empty() {
        SelectionCaptureSource::Unavailable
    } else {
        raw.source
    };

    SelectionCaptureResult {
        selection_id: Uuid::new_v4().to_string(),
        char_count: text.chars().count(),
        text,
        source,
        captured_at: now_unix_ms(),
        truncated,
        diagnostics: SelectionCaptureDiagnostics {
            native_available: raw.native_available,
            clipboard_fallback_attempted: raw.clipboard_fallback_attempted,
            clipboard_restored: raw.clipboard_restored,
            error: raw.error,
        },
    }
}

fn truncate_to_max_bytes(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }

    let mut end = 0;
    for (index, _) in value.char_indices() {
        if index > max_bytes {
            break;
        }
        end = index;
    }
    if end == 0 {
        return (String::new(), true);
    }
    (value[..end].trim_end().to_string(), true)
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn capture_from_clipboard_fallback() -> RawCapture {
    let snapshot = read_clipboard_text();
    let before_change_count = clipboard_change_count();

    wait_for_copy_shortcut_modifiers_to_clear(Duration::from_millis(MODIFIER_RELEASE_TIMEOUT_MS));
    send_copy_shortcut();
    std::thread::sleep(Duration::from_millis(COPY_FALLBACK_DELAY_MS));

    let captured = read_clipboard_text();
    let after_change_count = clipboard_change_count();
    let text_changed = match (&snapshot, &captured) {
        (Some(before), Some(after)) => before != after,
        (None, Some(_)) => true,
        _ => false,
    };
    let clipboard_changed = match (before_change_count, after_change_count) {
        (Some(before), Some(after)) => before != after,
        _ => false,
    };

    let mut clipboard_restored = false;
    if let Some(original) = snapshot {
        clipboard_restored = write_clipboard_text(&original);
    }

    let text = if text_changed || clipboard_changed {
        captured.unwrap_or_default()
    } else {
        String::new()
    };

    RawCapture {
        text,
        source: SelectionCaptureSource::ClipboardFallback,
        native_available: false,
        clipboard_fallback_attempted: true,
        clipboard_restored,
        error: None,
    }
}

#[cfg(target_os = "windows")]
fn read_clipboard_text() -> Option<String> {
    clipboard_win::get_clipboard_string().ok()
}

#[cfg(target_os = "linux")]
fn read_clipboard_text() -> Option<String> {
    run_stdout_command("xclip", &["-selection", "clipboard", "-out"])
        .or_else(|| run_stdout_command("xsel", &["--clipboard", "--output"]))
}

#[cfg(target_os = "windows")]
fn write_clipboard_text(text: &str) -> bool {
    clipboard_win::set_clipboard_string(text).is_ok()
}

#[cfg(target_os = "linux")]
fn write_clipboard_text(text: &str) -> bool {
    write_stdin_command("xclip", &["-selection", "clipboard", "-in"], text)
        || write_stdin_command("xsel", &["--clipboard", "--input"], text)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn read_clipboard_text() -> Option<String> {
    None
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn write_clipboard_text(_text: &str) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn read_accessibility_selected_text() -> Option<String> {
    use windows::{
        core::Interface,
        Win32::{
            Foundation::RPC_E_CHANGED_MODE,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Accessibility::{
                CUIAutomation, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId,
            },
        },
    };

    unsafe {
        let init_result = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if init_result.is_err() && init_result != RPC_E_CHANGED_MODE {
            log::warn!(
                "selection accessibility capture skipped: CoInitializeEx failed: {init_result:?}"
            );
            return None;
        }
        let should_uninitialize = init_result.is_ok();

        let result = (|| {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let focused = automation.GetFocusedElement().ok()?;
            let pattern: IUIAutomationTextPattern = focused
                .GetCurrentPattern(UIA_TextPatternId)
                .ok()?
                .cast()
                .ok()?;
            let ranges = pattern.GetSelection().ok()?;
            let count = ranges.Length().ok()?.max(0);
            let mut parts = Vec::new();

            for index in 0..count {
                let range = ranges.GetElement(index).ok()?;
                let text = range.GetText(-1).ok()?;
                let text = String::from_utf16_lossy(&text);
                if !text.trim().is_empty() {
                    parts.push(text);
                }
            }

            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        })();

        if should_uninitialize {
            CoUninitialize();
        }

        result
    }
}

#[cfg(target_os = "macos")]
fn read_accessibility_selected_text() -> Option<String> {
    if !is_macos_accessibility_trusted() {
        return None;
    }

    use core_foundation::{
        base::{CFRelease, CFType, CFTypeRef, TCFType},
        string::{CFString, CFStringRef},
    };

    type AXUIElementRef = *const libc::c_void;
    type AXError = i32;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
    }

    const AX_ERROR_SUCCESS: AXError = 0;

    unsafe {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return None;
        }

        let focused_attr = CFString::new("AXFocusedUIElement");
        let mut focused_ref: CFTypeRef = std::ptr::null();
        let focused_err = AXUIElementCopyAttributeValue(
            system,
            focused_attr.as_concrete_TypeRef(),
            &mut focused_ref,
        );
        CFRelease(system as CFTypeRef);
        if focused_err != AX_ERROR_SUCCESS || focused_ref.is_null() {
            return None;
        }
        let focused = CFType::wrap_under_create_rule(focused_ref);

        let selected_attr = CFString::new("AXSelectedText");
        let mut selected_ref: CFTypeRef = std::ptr::null();
        let selected_err = AXUIElementCopyAttributeValue(
            focused.as_CFTypeRef() as AXUIElementRef,
            selected_attr.as_concrete_TypeRef(),
            &mut selected_ref,
        );
        if selected_err != AX_ERROR_SUCCESS || selected_ref.is_null() {
            return None;
        }

        let selected = CFType::wrap_under_create_rule(selected_ref);
        let text = selected.downcast_into::<CFString>()?.to_string();
        if text.trim().is_empty() {
            None
        } else {
            Some(text)
        }
    }
}

#[cfg(target_os = "macos")]
fn is_macos_accessibility_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *mut libc::c_void) -> bool;
    }

    unsafe { AXIsProcessTrustedWithOptions(std::ptr::null_mut()) }
}

#[cfg(target_os = "linux")]
fn read_accessibility_selected_text() -> Option<String> {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            log::warn!("selection AT-SPI capture skipped: runtime creation failed: {err:?}");
            return None;
        }
    };

    match runtime.block_on(async {
        tokio::time::timeout(
            Duration::from_millis(AT_SPI_CAPTURE_TIMEOUT_MS),
            read_linux_atspi_selected_text(),
        )
        .await
    }) {
        Ok(Ok(text)) => text,
        Ok(Err(err)) => {
            log::warn!("selection AT-SPI capture skipped: {err:?}");
            None
        }
        Err(_) => {
            log::warn!("selection AT-SPI capture skipped: timed out");
            None
        }
    }
}

#[cfg(target_os = "linux")]
async fn read_linux_atspi_selected_text(
) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
    use atspi_common::{Interface, State};
    use atspi_connection::AccessibilityConnection;
    use atspi_proxies::accessible::{AccessibleProxy, ObjectRefExt};
    use std::collections::VecDeque;

    let accessibility = AccessibilityConnection::new().await?;
    let connection = accessibility.connection();
    let root = accessibility.root_accessible_on_registry().await?;
    let mut queue: VecDeque<AccessibleProxy<'_>> = VecDeque::from([root]);
    let mut visited = 0usize;

    while let Some(accessible) = queue.pop_front() {
        visited += 1;
        if visited > AT_SPI_MAX_TRAVERSAL_NODES {
            break;
        }

        let interfaces = accessible.get_interfaces().await.ok();
        let state = accessible.get_state().await.ok();
        let is_focused = state
            .map(|state| state.contains(State::Focused))
            .unwrap_or(false);
        let has_text = interfaces
            .map(|interfaces| interfaces.contains(Interface::Text))
            .unwrap_or(false);

        if is_focused && has_text {
            if let Some(text) = read_linux_text_selection(&accessible).await {
                return Ok(Some(text));
            }
        }

        let Ok(children) = accessible.get_children().await else {
            continue;
        };
        for child in children.into_iter().take(AT_SPI_MAX_CHILDREN_PER_NODE) {
            if let Ok(child) = child.into_accessible_proxy(connection).await {
                queue.push_back(child);
            }
        }
    }

    Ok(None)
}

#[cfg(target_os = "linux")]
async fn read_linux_text_selection(
    accessible: &atspi_proxies::accessible::AccessibleProxy<'_>,
) -> Option<String> {
    use atspi_proxies::text::TextProxy;

    let text_proxy = TextProxy::builder(accessible.inner().connection())
        .destination(accessible.inner().destination().clone())
        .ok()?
        .path(accessible.inner().path().clone())
        .ok()?
        .build()
        .await
        .ok()?;
    let selection_count = text_proxy.get_nselections().await.ok()?.clamp(0, 8);
    let mut parts = Vec::new();

    for index in 0..selection_count {
        let (start, end) = text_proxy.get_selection(index).await.ok()?;
        if end <= start {
            continue;
        }
        let text = text_proxy.get_text(start, end).await.ok()?;
        if !text.trim().is_empty() {
            parts.push(text);
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn read_accessibility_selected_text() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn clipboard_change_count() -> Option<i64> {
    use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
    let count = unsafe { GetClipboardSequenceNumber() };
    if count == 0 {
        None
    } else {
        Some(i64::from(count))
    }
}

#[cfg(target_os = "macos")]
fn clipboard_change_count() -> Option<i64> {
    None
}

#[cfg(target_os = "linux")]
fn clipboard_change_count() -> Option<i64> {
    None
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn clipboard_change_count() -> Option<i64> {
    None
}

#[cfg(target_os = "windows")]
fn wait_for_copy_shortcut_modifiers_to_clear(timeout: Duration) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    let keys = [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN];
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        let pressed = keys
            .iter()
            .any(|key| unsafe { (GetAsyncKeyState(key.0 as i32) as u16 & 0x8000) != 0 });
        if !pressed {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(target_os = "macos")]
fn wait_for_copy_shortcut_modifiers_to_clear(timeout: Duration) {
    use core_graphics::{event::CGEventFlags, event_source::CGEventSourceStateID};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceFlagsState(state_id: CGEventSourceStateID) -> u64;
    }

    let mask = CGEventFlags::CGEventFlagShift.bits()
        | CGEventFlags::CGEventFlagControl.bits()
        | CGEventFlags::CGEventFlagAlternate.bits()
        | CGEventFlags::CGEventFlagCommand.bits();
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        let flags = unsafe { CGEventSourceFlagsState(CGEventSourceStateID::CombinedSessionState) };
        if flags & mask == 0 {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(target_os = "linux")]
fn wait_for_copy_shortcut_modifiers_to_clear(timeout: Duration) {
    std::thread::sleep(timeout.min(Duration::from_millis(120)));
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn wait_for_copy_shortcut_modifiers_to_clear(timeout: Duration) {
    std::thread::sleep(timeout.min(Duration::from_millis(120)));
}

#[cfg(target_os = "windows")]
fn send_copy_shortcut() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_C, VK_CONTROL,
    };

    unsafe {
        keybd_event(VK_CONTROL.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(VK_C.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(VK_C.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_CONTROL.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}

#[cfg(target_os = "macos")]
fn send_copy_shortcut() {
    if !is_macos_accessibility_trusted() {
        return;
    }

    use core_graphics::{
        event::{CGEvent, CGEventFlags, CGEventTapLocation},
        event_source::{CGEventSource, CGEventSourceStateID},
    };

    let source = match CGEventSource::new(CGEventSourceStateID::Private) {
        Ok(source) => source,
        Err(err) => {
            log::warn!("selection copy fallback skipped: CGEventSource failed: {err:?}");
            return;
        }
    };

    const KEY_C: core_graphics::event::CGKeyCode = 8;
    let down = match CGEvent::new_keyboard_event(source.clone(), KEY_C, true) {
        Ok(event) => event,
        Err(err) => {
            log::warn!("selection copy fallback skipped: key down failed: {err:?}");
            return;
        }
    };
    down.set_flags(CGEventFlags::CGEventFlagCommand);
    down.post(CGEventTapLocation::HID);

    let up = match CGEvent::new_keyboard_event(source, KEY_C, false) {
        Ok(event) => event,
        Err(err) => {
            log::warn!("selection copy fallback skipped: key up failed: {err:?}");
            return;
        }
    };
    up.set_flags(CGEventFlags::CGEventFlagCommand);
    up.post(CGEventTapLocation::HID);
}

#[cfg(target_os = "linux")]
fn send_copy_shortcut() {
    if !is_linux_x11_session_available() {
        return;
    }

    let status = std::process::Command::new("xdotool")
        .args(["key", "--clearmodifiers", "ctrl+c"])
        .status();
    if let Err(err) = status {
        log::warn!("selection X11 copy fallback skipped: xdotool failed: {err:?}");
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn send_copy_shortcut() {}

#[cfg(target_os = "linux")]
fn is_linux_x11_session_available() -> bool {
    match std::env::var("XDG_SESSION_TYPE") {
        Ok(session_type) if session_type.eq_ignore_ascii_case("wayland") => false,
        Ok(session_type) if session_type.eq_ignore_ascii_case("x11") => true,
        _ => std::env::var_os("DISPLAY").is_some(),
    }
}

#[cfg(target_os = "linux")]
fn run_stdout_command(command: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(command)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

#[cfg(target_os = "linux")]
fn write_stdin_command(command: &str, args: &[&str], text: &str) -> bool {
    use std::io::Write;

    let mut child = match std::process::Command::new(command)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return false,
    };
    let Some(stdin) = child.stdin.as_mut() else {
        return false;
    };
    if stdin.write_all(text.as_bytes()).is_err() {
        return false;
    }
    child.wait().map(|status| status.success()).unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn read_clipboard_text() -> Option<String> {
    let output = std::process::Command::new("pbpaste").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

#[cfg(target_os = "macos")]
fn write_clipboard_text(text: &str) -> bool {
    use std::io::Write;

    let mut child = match std::process::Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return false,
    };
    let Some(stdin) = child.stdin.as_mut() else {
        return false;
    };
    if stdin.write_all(text.as_bytes()).is_err() {
        return false;
    }
    child.wait().map(|status| status.success()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(text: &str) -> RawCapture {
        RawCapture {
            text: text.to_string(),
            source: SelectionCaptureSource::ClipboardFallback,
            native_available: false,
            clipboard_fallback_attempted: true,
            clipboard_restored: true,
            error: None,
        }
    }

    #[test]
    fn empty_capture_is_unavailable() {
        let result = normalize_capture(raw("   "));
        assert_eq!(result.source, SelectionCaptureSource::Unavailable);
        assert_eq!(result.char_count, 0);
        assert!(!result.truncated);
    }

    #[test]
    fn capture_trims_surrounding_whitespace() {
        let result = normalize_capture(raw("\n selected text \n"));
        assert_eq!(result.text, "selected text");
        assert_eq!(result.char_count, 13);
    }

    #[test]
    fn truncation_respects_utf8_boundaries() {
        let value = format!("{}{}", "a".repeat(MAX_SELECTION_BYTES), "中");
        let result = normalize_capture(raw(&value));
        assert_eq!(result.text.len(), MAX_SELECTION_BYTES);
        assert!(result.truncated);
    }
}
