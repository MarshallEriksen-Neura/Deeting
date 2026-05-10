use std::collections::HashSet;

use mcp_registry::types::LocalCapabilityRegistryUpsert;
use serde_json::{json, Value};

use crate::modules::execution::core_tool::{
    shell_execute_example_arguments, shell_execute_input_schema, shell_execute_output_schema,
    shell_execute_tool_description, SHELL_EXECUTE_TOOL_NAME,
};

use crate::modules::generated_files::docx_generator::{
    write_docx_input_schema, write_docx_tool_description,
};
use crate::modules::generated_files::pptx_generator::{
    write_pptx_input_schema, write_pptx_tool_description,
};

const LEGACY_CORE_TOOL_PACKAGE_ID: &str = "code_mode.core";
const CORE_TOOL_PACKAGE_ID: &str = "desktop_runtime.core";

#[derive(Clone)]
pub(crate) struct CoreToolContract {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
    pub output_schema: Value,
    pub permission_scope: &'static [&'static str],
    pub read_only: bool,
    pub mutating: bool,
    pub risk_level: &'static str,
    pub example_arguments: Value,
}

impl CoreToolContract {
    pub(crate) fn as_function_tool(&self) -> Value {
        json!({
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            }
        })
    }

    pub(crate) fn as_catalog_asset(&self) -> Value {
        json!({
            "id": format!("core.{}", self.name),
            "name": self.name,
            "description": self.description,
            "asset_type": "tool",
            "source_type": "desktop_runtime_core",
            "pkg_name": "desktop_runtime.core",
            "metadata": self.contract_metadata(),
        })
    }

    fn contract_metadata(&self) -> Value {
        json!({
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
            "permission_scope": self.permission_scope,
            "discovery_terms": self.discovery_terms(),
            "read_only": self.read_only,
            "mutating": self.mutating,
            "risk_level": self.risk_level,
            "example_arguments": self.example_arguments,
            "activation_state": "enabled",
            "runtime_state": "ready",
            "search_index_state": "not_required",
        })
    }

    fn discovery_terms(&self) -> Value {
        if !self.name.starts_with("browser_") {
            return json!([]);
        }

        let mut terms = vec![
            "desktop local browser",
            "desktop-local Chrome extension",
            "local browser agent bridge",
            "browser extension lane",
            "current browser tab",
            "active browser tab",
            "existing browser tab",
            "already-open browser page",
            "attach existing browser tab",
            "read current browser page",
            "inspect current tab content",
            "读取当前浏览器",
            "读取当前页面",
            "查看当前标签页",
            "已打开浏览器",
            "已打开页面",
            "附着现有标签页",
        ];

        match self.name {
            "browser_agent_status" => terms.extend([
                "check browser extension connection",
                "browser bridge reachable",
                "active extension session",
            ]),
            "browser_get_active_page" => terms.extend([
                "get active page",
                "get current tab id",
                "attach to current tab",
                "current page url title",
                "当前活动页面",
            ]),
            "browser_tabs" => terms.extend([
                "list open tabs",
                "switch active tab",
                "select existing tab",
                "open tab list",
                "列出浏览器标签页",
            ]),
            "browser_get_page_snapshot" | "browser_extract" => terms.extend([
                "read page content",
                "extract current page text",
                "visible text links buttons",
                "browser page snapshot",
                "读取页面内容",
            ]),
            "browser_click" => terms.extend([
                "click browser element",
                "click button link page control",
                "press browser page button",
                "点击浏览器元素",
                "点击页面按钮",
            ]),
            "browser_type" => terms.extend([
                "type text into browser input",
                "enter text in page field",
                "write text to form field",
                "write social media post",
                "compose tweet text",
                "type twitter post",
                "input text",
                "填写文本",
                "输入文本",
                "写入浏览器输入框",
                "撰写推文",
                "输入发帖内容",
            ]),
            "browser_fill" => terms.extend([
                "fill browser form",
                "clear and fill input field",
                "fill page field",
                "fill social media compose box",
                "fill twitter post field",
                "compose social media post",
                "form input",
                "browser form field",
                "填写浏览器表单",
                "填充表单",
                "填写输入框",
                "填写发帖框",
                "填写推文",
                "社交媒体发帖",
            ]),
            "browser_key" => terms.extend([
                "keyboard input",
                "send keyboard key",
                "press enter shortcut",
                "browser keyboard shortcut",
                "键盘输入",
                "发送按键",
                "快捷键",
            ]),
            "browser_select" => terms.extend([
                "select option",
                "choose dropdown option",
                "checkbox radio date input",
                "选择下拉选项",
                "勾选复选框",
            ]),
            "browser_upload_file" => terms.extend([
                "upload file input",
                "attach file to browser form",
                "browser file picker",
                "上传文件",
                "附件表单",
            ]),
            _ => {}
        }

        json!(terms)
    }
}

pub(crate) fn build_core_tool_function_entries() -> Vec<Value> {
    desktop_runtime_core_tools()
        .into_iter()
        .map(|tool| tool.as_function_tool())
        .collect()
}

pub(crate) fn build_core_tool_assets() -> Vec<Value> {
    desktop_runtime_core_tools()
        .into_iter()
        .map(|tool| tool.as_catalog_asset())
        .collect()
}

fn browser_tool_contract(
    name: &'static str,
    description: &'static str,
    input_schema: Value,
    permission_scope: &'static [&'static str],
    read_only: bool,
    mutating: bool,
    risk_level: &'static str,
    example_arguments: Value,
) -> CoreToolContract {
    CoreToolContract {
        name,
        description,
        input_schema,
        output_schema: json!({
            "type": "object",
            "additionalProperties": true
        }),
        permission_scope,
        read_only,
        mutating,
        risk_level,
        example_arguments,
    }
}

fn browser_tab_id_property(description: &'static str) -> Value {
    json!({
        "type": "integer",
        "description": description
    })
}

fn browser_locator_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "selector": {"type": "string", "description": "CSS selector to resolve in the page."},
            "text": {"type": "string", "description": "Visible text to match."},
            "role": {"type": "string", "description": "Accessible role to match, such as button or link."},
            "tag_name": {"type": "string", "description": "Element tag name. camelCase alias tagName is also accepted."},
            "placeholder": {"type": "string", "description": "Placeholder text to match."},
            "element_id": {"type": "string", "description": "Stable snapshot element id. camelCase alias elementId is also accepted."},
            "aria_label": {"type": "string", "description": "ARIA label to match. camelCase alias ariaLabel is also accepted."},
            "accessible_name": {"type": "string", "description": "Accessible name to match. camelCase alias accessibleName is also accepted."},
            "href": {"type": "string", "description": "Link href to match."},
            "test_id": {"type": "string", "description": "Test id or data-testid value. camelCase alias testId is also accepted."},
            "frame_id": {"type": "string", "description": "Frame identifier when targeting a nested frame. camelCase alias frameId is also accepted."},
            "index": {"type": "integer", "description": "Optional match index when more than one element satisfies the locator."}
        },
        "additionalProperties": true
    })
}

fn browser_locator_property(description: &'static str) -> Value {
    let mut schema = browser_locator_schema();
    if let Some(object) = schema.as_object_mut() {
        object.insert(
            "description".to_string(),
            Value::String(description.to_string()),
        );
    }
    schema
}

fn browser_region_property() -> Value {
    json!({
        "type": "object",
        "description": "Optional viewport region override when no target locator is provided.",
        "properties": {
            "x": {"type": "number"},
            "y": {"type": "number"},
            "width": {"type": "number"},
            "height": {"type": "number"},
            "top": {"type": "number"},
            "right": {"type": "number"},
            "bottom": {"type": "number"},
            "left": {"type": "number"}
        },
        "additionalProperties": true
    })
}

fn browser_expanded_permission_scope(mutating: bool) -> &'static [&'static str] {
    if mutating {
        &["browser_agent_write", "local_runtime"]
    } else {
        &["browser_agent_read", "local_runtime"]
    }
}

fn browser_expanded_tool_contract(
    name: &'static str,
    description: &'static str,
    read_only: bool,
    mutating: bool,
    risk_level: &'static str,
    example_arguments: Value,
) -> CoreToolContract {
    browser_tool_contract(
        name,
        description,
        browser_expanded_input_schema(name),
        browser_expanded_permission_scope(mutating),
        read_only,
        mutating,
        risk_level,
        example_arguments,
    )
}

fn browser_extract_contract() -> CoreToolContract {
    browser_tool_contract(
        "browser_extract",
        "Extract structured content from a browser tab, such as visible text, article text, tables, links, images, metadata, or JSON-LD.",
        json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to extract from. This is normalized to the extension tabId field."),
                "mode": {
                    "type": "string",
                    "enum": ["summary", "main_text", "links", "tables", "metadata"],
                    "description": "Extraction mode. Omit or use summary for bounded page text."
                },
                "target": browser_locator_property("Optional structured locator that scopes extraction to one element. Use fields such as selector, text, role, tag_name/tagName, element_id/elementId, aria_label/ariaLabel, accessible_name/accessibleName, href, test_id/testId, frame_id/frameId, or index."),
                "options": {
                    "type": "object",
                    "description": "Optional extraction options reserved for the browser extension.",
                    "additionalProperties": true
                }
            },
            "required": ["tab_id"],
            "additionalProperties": true
        }),
        browser_expanded_permission_scope(false),
        true,
        false,
        "MEDIUM",
        json!({"tab_id": 42, "mode": "summary"}),
    )
}

fn browser_expanded_input_schema(name: &str) -> Value {
    match name {
        "browser_navigate_tab" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to navigate. This is normalized to the extension tabId field."),
                "url": {"type": "string", "description": "Target http or https URL."}
            },
            "required": ["tab_id", "url"],
            "additionalProperties": true
        }),
        "browser_find_element" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to search. This is normalized to the extension tabId field."),
                "target": browser_locator_property("Required structured locator for the element to find.")
            },
            "required": ["tab_id", "target"],
            "additionalProperties": true
        }),
        "browser_region_screenshot" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to capture. This is normalized to the extension tabId field."),
                "target": browser_locator_property("Optional structured locator for the element whose bounds should be returned with the visible screenshot."),
                "region": browser_region_property()
            },
            "required": ["tab_id"],
            "additionalProperties": true
        }),
        "browser_full_page_screenshot" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to capture. This is normalized to the extension tabId field.")
            },
            "required": ["tab_id"],
            "additionalProperties": true
        }),
        "browser_get_active_page" => json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
        "browser_wait" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to wait in. This is normalized to the extension tabId field."),
                "mode": {"type": "string", "enum": ["element", "text", "url", "title", "readyState"], "description": "Condition type to wait for."},
                "target": browser_locator_property("Required when mode is element."),
                "text": {"type": "string", "description": "Text to wait for when mode is text."},
                "url": {"type": "string", "description": "URL substring to wait for when mode is url."},
                "title": {"type": "string", "description": "Title substring to wait for when mode is title."},
                "wait_for_ready_state": {"type": "string", "enum": ["loading", "interactive", "complete"], "description": "ReadyState to wait for. This is normalized to waitForReadyState."},
                "timeout_ms": {"type": "integer", "minimum": 1, "description": "Maximum wait time in milliseconds. This is normalized to timeoutMs."},
                "poll_interval_ms": {"type": "integer", "minimum": 1, "description": "Polling interval in milliseconds. This is normalized to pollIntervalMs."}
            },
            "required": ["tab_id", "mode"],
            "additionalProperties": true
        }),
        "browser_tabs" => json!({
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "switch", "create", "close"], "description": "Tab operation to perform."},
                "tab_id": browser_tab_id_property("Browser tab identifier. Required for switch and close. This is normalized to tabId."),
                "url": {"type": "string", "description": "URL for action=create."}
            },
            "required": ["action"],
            "additionalProperties": true
        }),
        "browser_fill" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier containing the field. This is normalized to tabId."),
                "target": browser_locator_property("Required structured locator for the field to fill."),
                "text": {"type": "string", "description": "Text to place into the field."},
                "submit_after": {"type": "boolean", "description": "Submit the closest form after filling. This is normalized to submitAfter."}
            },
            "required": ["tab_id", "target", "text"],
            "additionalProperties": true
        }),
        "browser_key" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier receiving the key event. This is normalized to tabId."),
                "target": browser_locator_property("Optional structured locator to focus before sending the key."),
                "key": {"type": "string", "description": "Keyboard key value such as Enter or Escape."}
            },
            "required": ["tab_id", "key"],
            "additionalProperties": true
        }),
        "browser_select" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier containing the control. This is normalized to tabId."),
                "target": browser_locator_property("Required structured locator for the select, checkbox, radio, or input control."),
                "value": {"description": "Option value/text or input value to select."},
                "checked": {"type": "boolean", "description": "Checkbox/radio checked state."}
            },
            "required": ["tab_id", "target"],
            "additionalProperties": true
        }),
        "browser_upload_file" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier containing the file input. This is normalized to tabId."),
                "target": browser_locator_property("Required structured locator for the file input."),
                "path": {"type": "string", "description": "Single local file path requested for upload."},
                "paths": {"type": "array", "items": {"type": "string"}, "description": "Multiple local file paths requested for upload."}
            },
            "required": ["tab_id", "target"],
            "additionalProperties": true
        }),
        "browser_downloads" => json!({
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "wait"], "description": "Download operation. Omit or use list to inspect recent downloads."},
                "limit": {"type": "integer", "minimum": 1, "description": "Maximum download records to return."},
                "filename_contains": {"type": "string", "description": "Filter downloads by filename or URL substring. This is normalized to filenameContains."},
                "timeout_ms": {"type": "integer", "minimum": 1, "description": "Maximum wait time for action=wait. This is normalized to timeoutMs."}
            },
            "additionalProperties": true
        }),
        "browser_dialog" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier. This is normalized to tabId."),
                "action": {"type": "string", "enum": ["status", "accept", "dismiss", "respond"], "description": "Dialog operation."},
                "text": {"type": "string", "description": "Prompt response text for action=respond."}
            },
            "required": ["tab_id"],
            "additionalProperties": true
        }),
        "browser_console_log" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to inspect. This is normalized to tabId."),
                "level": {"type": "string", "enum": ["log", "warn", "error"], "description": "Optional console level filter."},
                "limit": {"type": "integer", "minimum": 1, "description": "Maximum log entries to return."}
            },
            "required": ["tab_id"],
            "additionalProperties": true
        }),
        "browser_network_log" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to inspect. This is normalized to tabId."),
                "include_failed": {"type": "boolean", "description": "Include failed requests. This is normalized to includeFailed."},
                "limit": {"type": "integer", "minimum": 1, "description": "Maximum resource entries to return."}
            },
            "required": ["tab_id"],
            "additionalProperties": true
        }),
        "browser_storage_read" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to inspect. This is normalized to tabId."),
                "area": {"type": "string", "enum": ["localStorage", "sessionStorage"], "description": "Storage area to read."},
                "key": {"type": "string", "description": "Optional key to read; omit to return bounded entries."}
            },
            "required": ["tab_id", "area"],
            "additionalProperties": true
        }),
        "browser_storage_write" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to mutate. This is normalized to tabId."),
                "area": {"type": "string", "enum": ["localStorage", "sessionStorage"], "description": "Storage area to write."},
                "key": {"type": "string", "description": "Storage key to write."},
                "value": {"description": "Value to store. Non-string values are JSON stringified by the extension."}
            },
            "required": ["tab_id", "area", "key", "value"],
            "additionalProperties": true
        }),
        "browser_eval" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to evaluate in. This is normalized to tabId."),
                "mode": {"type": "string", "enum": ["read", "write"], "description": "Use read for current extension execution. write is blocked by the content surface."},
                "code": {"type": "string", "description": "JavaScript expression to evaluate in the page context."}
            },
            "required": ["tab_id", "code"],
            "additionalProperties": true
        }),
        "browser_highlight" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier containing the element. This is normalized to tabId."),
                "target": browser_locator_property("Required structured locator for the element to highlight."),
                "duration_ms": {"type": "integer", "minimum": 1, "description": "Highlight duration in milliseconds. This is normalized to durationMs."}
            },
            "required": ["tab_id", "target"],
            "additionalProperties": true
        }),
        "browser_accessibility_audit" => json!({
            "type": "object",
            "properties": {
                "tab_id": browser_tab_id_property("Browser tab identifier to audit. This is normalized to tabId.")
            },
            "required": ["tab_id"],
            "additionalProperties": true
        }),
        _ => json!({
            "type": "object",
            "additionalProperties": true
        }),
    }
}

pub(crate) fn desktop_runtime_core_tools() -> Vec<CoreToolContract> {
    vec![
        CoreToolContract {
            name: "search_sdk",
            description: "Search desktop capability control-plane objects by intent and return semantic groups for direct capabilities, grouped capability namespaces, recipes, and orchestration primitives. Direct capabilities include skill tool bindings and user MCP tools. Recipes are guidance-oriented skill or assistant bundles and are not directly callable tools. Summary results stay lightweight for model selection; use detail_level='full' or get_tool_schema for internal diagnostics or exact invocation contracts. execute_code_plan is only for multi-step orchestration.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural language intent to search tools." },
                    "limit": { "type": "integer", "description": "Max capability results to return (1-20).", "default": 8 },
                    "detail_level": {
                        "type": "string",
                        "description": "Return lightweight references with 'summary' or include full tool contracts with 'full'.",
                        "enum": ["summary", "full"],
                        "default": "summary"
                    }
                },
                "required": ["query"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "format_version": {"type": "string"},
                    "mode": {"type": "string"},
                    "detail_level": {"type": "string"},
                    "query": {"type": "string"},
                    "count": {"type": "integer"},
                    "capabilities": {"type": "array"},
                    "capability_groups": {"type": "object"},
                    "recipes": {"type": "array"},
                    "recipe_groups": {"type": "object"},
                    "orchestration_primitives": {"type": "array"}
                },
                "required": ["format_version", "mode", "query", "count", "capabilities", "recipes", "orchestration_primitives"]
            }),
            permission_scope: &["local_catalog_read", "capability_discovery"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({"query": "search web tools", "limit": 8, "detail_level": "summary"}),
        },
        CoreToolContract {
            name: "query_task_policy",
            description: "Read bounded task-learning priors for one decision point under the current task fingerprint. Use this at explicit decision gates such as route choice, whether to call search_sdk early, whether to attach a capability, whether execute_code_plan is justified, or whether a user-requested verification needs stronger evidence. This is read-only policy retrieval and must not create a new user goal or replace the requested deliverable.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural-language task query used to build the task fingerprint." },
                    "decision_point": {
                        "type": "string",
                        "description": "Decision layer to inspect.",
                        "enum": ["route", "discovery", "capability_attach", "execution", "verification"]
                    },
                    "limit": { "type": "integer", "description": "Maximum priors to return (1-8).", "default": 4 }
                },
                "required": ["query", "decision_point"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "decision_point": {"type": "string"},
                    "fingerprint_key": {"type": "string"},
                    "task_fingerprint": {"type": "object"},
                    "recommended_action": {"type": ["string", "null"]},
                    "priors": {"type": "array"},
                    "guidance": {"type": ["string", "null"]}
                },
                "required": ["query", "decision_point", "fingerprint_key", "task_fingerprint", "priors"]
            }),
            permission_scope: &["local_catalog_read", "task_policy_read"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({
                "query": "Investigate the current desktop runtime route boundary",
                "decision_point": "discovery",
                "limit": 4
            }),
        },
        CoreToolContract {
            name: "diting_think",
            description: "Structured deep-reasoning tool. Call this ONCE before executing any other tool when the task involves multi-step execution, ambiguous intent, or coordination across multiple capabilities. Analyze the user intent against the currently available tools and context, then output a concrete execution plan. Do NOT call this for trivial single-tool tasks. This tool is only available in the first round and disappears afterward.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "intent": {
                        "type": "string",
                        "description": "One-sentence summary of the user's core intent."
                    },
                    "context_assessment": {
                        "type": "string",
                        "description": "Relevant context already available: injected memories, prior conversation state, discovered capabilities. What do you already know that matters?"
                    },
                    "tool_plan": {
                        "type": "string",
                        "description": "Which tools to call, in what order, with what arguments. Be specific — name exact tools and justify the sequence."
                    },
                    "constraints": {
                        "type": "string",
                        "description": "Key risks, edge cases, permission boundaries, or scope limits that could derail execution."
                    }
                },
                "required": ["intent", "tool_plan"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "status": {"type": "string"},
                    "reasoning": {"type": "string"}
                },
                "required": ["status", "reasoning"]
            }),
            permission_scope: &["local_reasoning"],
            read_only: true,
            mutating: false,
            risk_level: "NONE",
            example_arguments: json!({
                "intent": "User wants to search the web for recent news and summarize findings",
                "tool_plan": "1. search_sdk to find web search capability, 2. attach_capability, 3. execute the web search tool with user query",
                "constraints": "Network access required; user did not specify language preference"
            }),
        },
        CoreToolContract {
            name: "get_tool_schema",
            description: "Return the full callable contract for a selected direct tool, including input schema, typed parameter docs, example arguments, and risk metadata. Use this after search_sdk summary results when you need exact invocation details for one chosen tool.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tool_name": { "type": "string", "description": "Exact tool name returned by search_sdk." }
                },
                "required": ["tool_name"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "tool_name": {"type": "string"},
                    "capability_id": {"type": ["string", "null"]},
                    "description": {"type": "string"},
                    "input_schema": {"type": "object"},
                    "required_parameters": {"type": "array"},
                    "python_stub": {"type": "string"}
                },
                "required": ["tool_name", "input_schema"]
            }),
            permission_scope: &["local_catalog_read", "capability_discovery"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({"tool_name": "browser_open_tab"}),
        },
        CoreToolContract {
            name: "activate_skill",
            description: "Activate an installed skill package for the current request and load its full SKILL.md instructions plus a bounded package-local resource index. Use this after search_sdk identifies a relevant skill recipe. This is read-only context expansion, not command execution.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "skill_id": {
                        "type": "string",
                        "description": "Stable skill id returned by search_sdk, for example official.skills.crawler."
                    }
                },
                "required": ["skill_id"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "status": {"type": "string"},
                    "scope": {"type": "string"},
                    "skill_id": {"type": "string"},
                    "instructions_path": {"type": "string"},
                    "instructions": {"type": "string"},
                    "instructions_hash": {"type": ["string", "null"]},
                    "instructions_length": {"type": "integer"},
                    "instructions_truncated": {"type": "boolean"},
                    "resource_index": {"type": "array"},
                    "next_step": {"type": "string"}
                },
                "required": ["status", "skill_id", "resource_index"]
            }),
            permission_scope: &["local_catalog_read", "skill_context_read"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({"skill_id": "official.skills.crawler"}),
        },
        CoreToolContract {
            name: "read_skill_resource",
            description: "Read a text resource inside an installed skill package after activation. Paths must be package-relative and stay under the skill root. Use for references, examples, templates, or script source named by SKILL.md. Do not use this for command execution.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "skill_id": {
                        "type": "string",
                        "description": "Optional stable skill id. May be omitted when the intended skill is already active in this request."
                    },
                    "path": {
                        "type": "string",
                        "description": "Package-relative resource path such as references/guide.md."
                    },
                    "max_bytes": {
                        "type": "integer",
                        "description": "Maximum bytes to return. The runtime enforces a hard cap.",
                        "default": 24576
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Byte offset for continuing a truncated read.",
                        "default": 0
                    }
                },
                "required": ["path"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "skill_id": {"type": "string"},
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                    "offset": {"type": "integer"},
                    "bytes_returned": {"type": "integer"},
                    "total_bytes": {"type": "integer"},
                    "truncated": {"type": "boolean"},
                    "next_offset": {"type": ["integer", "null"]}
                },
                "required": ["skill_id", "path", "content", "truncated"]
            }),
            permission_scope: &["local_catalog_read", "skill_context_read"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({"skill_id": "official.skills.crawler", "path": "references/usage.md"}),
        },
        CoreToolContract {
            name: "delegate_task",
            description: "Delegate one bounded subtask to an enabled local custom task agent and return a canonical delegated_result object. Use this only when the task is separable, a specialist local agent is available, and the parent assistant can integrate the result afterward. Do not use it for simple direct answers or to avoid final responsibility.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "Optional explicit custom task agent id discovered from search_sdk. If omitted, the runtime selects the best enabled discoverable agent."
                    },
                    "task": {
                        "type": "string",
                        "description": "Required bounded task for the delegated agent. Include only the subtask, not broad orchestration instructions."
                    },
                    "context_refs": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional concise references to current files, messages, assets, or evidence the child should consider."
                    },
                    "constraints": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional hard constraints, non-goals, or safety boundaries for the delegated subtask."
                    },
                    "expected_output": {
                        "type": "object",
                        "description": "Optional expected output contract such as {kind, schema}."
                    },
                    "max_rounds": {
                        "type": "integer",
                        "description": "Optional maximum child-agent tool rounds. If omitted, the child inherits the current per-task execution budget. Requested values are capped by the runtime budget.",
                        "default": 150
                    }
                },
                "required": ["task"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "type": {"type": "string"},
                    "schema_version": {"type": "integer"},
                    "kind": {"type": "string"},
                    "authoritative": {"type": "boolean"},
                    "status": {"type": "string"},
                    "execution_id": {"type": "string"},
                    "target": {"type": "object"},
                    "selection": {"type": "object"},
                    "packet_receipt": {"type": "object"},
                    "summary": {"type": ["string", "null"]},
                    "primary_output": {"type": ["object", "null"]},
                    "error": {"type": ["string", "null"]}
                },
                "required": ["type", "schema_version", "status", "execution_id", "target"]
            }),
            permission_scope: &["local_runtime", "agent_delegation"],
            read_only: false,
            mutating: true,
            risk_level: "MEDIUM",
            example_arguments: json!({
                "task": "Review this bounded implementation plan for missing runtime constraints.",
                "constraints": ["Do not modify files", "Return findings and risks only"],
                "expected_output": {"kind": "findings"},
                "max_rounds": 150
            }),
        },
        CoreToolContract {
            name: "execute_code_plan",
            description: "Run a bounded codemode tool call in the sandbox. Use it only for multi-step program logic, loops, branching, or broad edits that cannot be completed with one lighter direct tool call. Runtime exposes `deeting.log()`, `deeting.section()`, and `deeting.call_tool()`. SDK tool stubs are only for direct callable host tools surfaced by search_sdk. The required `code` field must contain one coherent executable Python script, not plan-only prose, markdown, pseudocode, or metadata. Keep planning implicit or as Python comments inside that script, and always emit final structured output via `deeting.log(json.dumps(result, ensure_ascii=False))` instead of relying on top-level `return`.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Optional high-level task summary for logging and result summarization." },
                    "scope": { "type": "object", "description": "Optional structured scope metadata such as selected paths or resources." },
                    "constraints": { "type": "object", "description": "Optional execution constraints such as read_only, max_steps, or mutation limits." },
                    "code": { "type": "string", "description": "Required full executable Python source to run in the sandbox. Must be non-empty and must not be replaced by plan-only text or metadata." },
                    "session_id": { "type": "string", "description": "Optional explicit session ID." },
                    "language": { "type": "string", "description": "Execution language. Only python is supported.", "default": "python" },
                    "execution_timeout": { "type": "integer", "description": "Execution timeout hint in seconds.", "default": 30 },
                    "dry_run": { "type": "boolean", "description": "Only validate code and return plan metadata without executing.", "default": false }
                },
                "required": ["code"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "status": {"type": "string"},
                    "summary": {"type": ["string", "null"]},
                    "actions": {"type": "array"},
                    "artifacts": {"type": "array"},
                    "result_blocks": {"type": "array"},
                    "runtime_mode": {"type": "string"},
                    "render_blocks": {"type": "array"},
                    "runtime_tool_calls": {"type": "array"}
                }
            }),
            permission_scope: &["sandbox_execution", "tool_bridge", "local_runtime"],
            read_only: false,
            mutating: true,
            risk_level: "HIGH",
            example_arguments: json!({
                "task": "Analyze and modify selected project files",
                "scope": { "paths": ["src/foo.rs", "src/bar.rs"] },
                "constraints": { "read_only": false, "max_steps": 8 },
                "code": "from deeting_sdk import search_sdk\nresult = search_sdk(query='search web tools')\ndeeting.log(json.dumps(result, ensure_ascii=False))",
                "language": "python",
                "dry_run": false
            }),
        },
        CoreToolContract {
            name: "run_local_code_snippet",
            description: "Run one assistant-generated code snippet inside the desktop-local BoxLite sandbox. Use this only for direct single-snippet execution in supported runtime images, not for broader orchestration. Supported languages in this slice are python, go, rust, and java. This tool requires the managed desktop sandbox to be ready and never falls back to raw host execution.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "code": { "type": "string", "description": "Required runnable code snippet source." },
                    "language": {
                        "type": "string",
                        "description": "Snippet language.",
                        "enum": ["python", "go", "rust", "java"]
                    },
                    "execution_timeout": {
                        "type": "integer",
                        "description": "Execution timeout hint in seconds.",
                        "default": 30
                    }
                },
                "required": ["code", "language"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "success": {"type": "boolean"},
                    "status": {"type": "string"},
                    "language": {"type": "string"},
                    "image": {"type": "string"},
                    "sandbox_id": {"type": ["string", "null"]},
                    "runtime_mode": {"type": "string"},
                    "stdout": {"type": "array"},
                    "stderr": {"type": "array"},
                    "result": {"type": "array"},
                    "exit_code": {"type": ["integer", "null"]},
                    "error": {"type": ["string", "null"]},
                    "error_code": {"type": ["string", "null"]},
                    "readiness": {"type": ["object", "null"]}
                },
                "required": ["success", "status", "language", "image", "runtime_mode", "stdout", "stderr", "result"]
            }),
            permission_scope: &["sandbox_execution", "local_runtime"],
            read_only: false,
            mutating: true,
            risk_level: "MEDIUM",
            example_arguments: json!({
                "language": "python",
                "code": "print('hello from BoxLite')",
                "execution_timeout": 30
            }),
        },
        CoreToolContract {
            name: "sys_submit_onboarding_request",
            description: "Create or install local desktop capabilities. Use `asset_type='skill'` with payload such as `{repo_url, skill_name}` to install a skill, `asset_type='assistant'` to create a local assistant, or `asset_type='custom_task_agent'` to create a reusable custom task agent with fields such as `{name, description, task_prompt, invocation_kind, callable_mcp_tool_ids, guidance_skill_ids, callable_skill_action_refs, tags, discoverable, is_enabled}`.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "asset_type": { "type": "string", "enum": ["assistant", "skill", "custom_task_agent"], "description": "Kind of asset to provision locally." },
                    "payload": { "type": "object", "description": "Structured onboarding payload for the selected asset type." }
                },
                "required": ["asset_type", "payload"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "action": {"type": "string"},
                    "id": {"type": "string"},
                    "status": {"type": "string"},
                    "result": {"type": "object"}
                }
            }),
            permission_scope: &["skill_install", "assistant_management", "local_state_write"],
            read_only: false,
            mutating: true,
            risk_level: "HIGH",
            example_arguments: json!({
                "asset_type": "skill",
                "payload": {
                    "repo_url": "https://github.com/example/weather-skill",
                    "skill_name": "weather"
                }
            }),
        },
        CoreToolContract {
            name: "save_asset",
            description: "Save a reusable local HTML asset for later retrieval and reference-guided regeneration. Persists source HTML plus lightweight asset metadata such as match hints, props hints, and output example schema.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "asset_id": { "type": "string", "description": "Stable local asset identifier." },
                    "title": { "type": "string", "description": "User-facing asset title." },
                    "html": { "type": "string", "description": "Full HTML document or fragment to persist as the asset entry." },
                    "summary": { "type": "string", "description": "Optional short summary shown in asset management surfaces." },
                    "render_hint": { "type": "string", "description": "Optional render hint reused when the asset is recalled." },
                    "data_mode": { "type": "string", "enum": ["ai_data", "self_fetch"], "description": "Whether future runs expect AI-provided data or self-fetched props." },
                    "match_hints": { "type": "array", "items": { "type": "string" }, "description": "Phrases used to match future prompts to this asset." },
                    "props_hint": { "type": "array", "items": { "type": "string" }, "description": "Parameters the model should extract when the asset is recalled." },
                    "output_example": { "type": "object", "description": "Example output data shape for future AI-generated render data." },
                    "origin_session_id": { "type": "string", "description": "Optional source chat session id." },
                    "origin_turn_index": { "type": "integer", "description": "Optional source turn index." },
                    "source_block_id": { "type": "string", "description": "Optional source block id." }
                },
                "required": ["asset_id", "title", "html"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string"},
                    "asset_kind": {"type": "string"},
                    "title": {"type": "string"},
                    "status": {"type": "string"},
                    "html_entry": {"type": ["string", "null"]},
                    "data_mode": {"type": ["string", "null"]},
                    "match_hints_json": {"type": ["string", "null"]},
                    "props_hint_json": {"type": ["string", "null"]},
                    "output_example_json": {"type": ["string", "null"]}
                },
                "required": ["asset_id", "asset_kind", "title", "status"]
            }),
            permission_scope: &["local_asset_write", "local_state_write"],
            read_only: false,
            mutating: true,
            risk_level: "HIGH",
            example_arguments: json!({
                "asset_id": "weather-ios18-card",
                "title": "Weather iOS18",
                "html": "<!doctype html><html><body><div id='app'></div></body></html>",
                "render_hint": "weather-card",
                "data_mode": "ai_data",
                "match_hints": ["weather", "天气"],
                "props_hint": ["location"],
                "output_example": { "location": "Beijing", "temp_c": 22 }
            }),
        },
        CoreToolContract {
            name: "monitor.create",
            description: "Create a local monitor task that runs an assistant on a schedule and records execution results.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Human-readable monitor title." },
                    "objective": { "type": "string", "description": "Task objective the assistant should execute." },
                    "assistant_id": { "type": "string", "description": "Required bound local chat task-agent ID for this monitor." },
                    "cron_expr": { "type": "string", "description": "Optional cron expression controlling the schedule." },
                    "analysis_mode": { "type": "string", "description": "Optional analysis mode override." },
                    "notify_config": { "type": "object", "description": "Optional notification configuration." },
                    "allowed_tools": { "type": "array", "items": { "type": "string" }, "description": "Optional effective tool allowlist intersected with the bound task-agent callables." },
                    "execution_target": { "type": "string", "description": "Optional execution target. Desktop-local monitor only accepts 'desktop'." }
                },
                "required": ["title", "objective", "assistant_id"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "status": {"type": "string"},
                    "message": {"type": "string"},
                    "analysis_mode": {"type": "string"},
                    "assistant_id": {"type": ["string", "null"]},
                    "execution_target": {"type": "string"}
                }
            }),
            permission_scope: &["monitor_write", "assistant_execution", "local_state_write"],
            read_only: false,
            mutating: true,
            risk_level: "HIGH",
            example_arguments: json!({
                "title": "Daily Site Check",
                "objective": "Check the homepage and summarize any visible failures.",
                "assistant_id": "agent.weather",
                "cron_expr": "0 */6 * * *"
            }),
        },
        CoreToolContract {
            name: "monitor.list",
            description: "List local monitor tasks with optional paging and status filtering.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "skip": { "type": "integer", "description": "Optional number of tasks to skip." },
                    "limit": { "type": "integer", "description": "Optional max number of tasks to return." },
                    "status": { "type": "string", "description": "Optional status filter." }
                }
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "items": {"type": "array"},
                    "total": {"type": "integer"},
                    "skip": {"type": "integer"},
                    "limit": {"type": "integer"}
                }
            }),
            permission_scope: &["monitor_read", "local_state_read"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({
                "limit": 20,
                "status": "active"
            }),
        },
        CoreToolContract {
            name: "refresh_skill_index",
            description: "Rescan local skill directories and rebuild the desktop skill registry after external installs, manual file changes, or shared-skill updates.",
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "status": {"type": "string"},
                    "registered": {"type": "integer"}
                },
                "required": ["status", "registered"]
            }),
            permission_scope: &["skill_registry_write", "local_catalog_refresh"],
            read_only: false,
            mutating: true,
            risk_level: "LOW",
            example_arguments: json!({}),
        },
        CoreToolContract {
            name: "browser_agent_status",
            description: "Inspect the desktop-local Chrome/browser agent bridge configuration, active extension session, current tab reachability, and whether the local browser extension lane can attach to already-open browser pages.",
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "bridge_url": {"type": "string"},
                    "config_source": {"type": "string"},
                    "configured": {"type": "boolean"},
                    "running": {"type": "boolean"},
                    "connected_sessions": {"type": "integer"},
                    "active_session_id": {"type": ["string", "null"]},
                    "reachable": {"type": "boolean"},
                    "status": {"type": "string"},
                    "status_reason": {"type": "string"}
                },
                "required": ["bridge_url", "config_source", "configured", "running", "connected_sessions", "reachable", "status", "status_reason"]
            }),
            permission_scope: &["browser_agent_read", "local_runtime"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({}),
        },
        CoreToolContract {
            name: "browser_open_tab",
            description: "Ask the connected desktop-local Chrome/browser agent extension to open a new browser tab for an http or https URL. Use this local browser bridge when the user wants a real browser tab instead of a remote browser session.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Target http or https URL to open in the browser." }
                },
                "required": ["url"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "tabId": {"type": ["integer", "null"]},
                    "url": {"type": "string"}
                },
                "required": ["url"]
            }),
            permission_scope: &["browser_agent_write", "local_runtime"],
            read_only: false,
            mutating: true,
            risk_level: "LOW",
            example_arguments: json!({"url": "https://example.com/docs"}),
        },
        CoreToolContract {
            name: "browser_get_page_snapshot",
            description: "Ask the connected desktop-local Chrome/browser agent extension to read the content of an existing browser tab by tab id and return a structured page snapshot. Use this after browser_get_active_page, browser_tabs, browser_open_tab, or browser navigation when the user asks to inspect the current page, current tab, visible text, links, buttons, posts, or page content.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tab_id": { "type": "integer", "description": "Browser tab identifier returned by browser_open_tab or prior browser actions." }
                },
                "required": ["tab_id"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "title": {"type": "string"},
                    "documentReadyState": {"type": "string"},
                    "visibleText": {"type": "string"},
                    "mainText": {"type": "string"},
                    "headings": {"type": "array"},
                    "links": {"type": "array"},
                    "buttons": {"type": "array"},
                    "inputs": {"type": "array"},
                    "forms": {"type": "array"}
                },
                "required": ["url", "title", "documentReadyState", "visibleText", "mainText", "headings", "links", "buttons", "inputs", "forms"]
            }),
            permission_scope: &["browser_agent_read", "local_runtime"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({"tab_id": 42}),
        },
        browser_expanded_tool_contract(
            "browser_navigate_tab",
            "Navigate an existing browser tab to an http or https URL through the local browser agent bridge.",
            false,
            true,
            "MEDIUM",
            json!({"tab_id": 42, "url": "https://example.com/search"}),
        ),
        browser_expanded_tool_contract(
            "browser_find_element",
            "Find a browser element by text, role, label, placeholder, selector, href, test id, or stable snapshot element id.",
            true,
            false,
            "MEDIUM",
            json!({"tab_id": 42, "target": {"text": "Continue"}}),
        ),
        browser_extract_contract(),
        browser_expanded_tool_contract(
            "browser_region_screenshot",
            "Capture a screenshot of a browser element or viewport region.",
            true,
            false,
            "MEDIUM",
            json!({"tab_id": 42, "target": {"selector": ".result"}}),
        ),
        browser_expanded_tool_contract(
            "browser_full_page_screenshot",
            "Capture a full-page screenshot from a browser tab with bounded output metadata.",
            true,
            false,
            "MEDIUM",
            json!({"tab_id": 42}),
        ),
        browser_expanded_tool_contract(
            "browser_get_active_page",
            "Return the active/current browser page known by the desktop-local Chrome/browser bridge. Use this to attach to an already-open browser tab, inspect the user's current tab, read the current page URL/title, or get the tab id before calling browser_get_page_snapshot or other tab-scoped browser tools.",
            true,
            false,
            "LOW",
            json!({}),
        ),
        browser_expanded_tool_contract(
            "browser_wait",
            "Wait for a browser condition such as element, text, URL, title, readyState, network idle, download, or dialog.",
            true,
            false,
            "MEDIUM",
            json!({"tab_id": 42, "mode": "text", "text": "Loaded", "timeout_ms": 10000}),
        ),
        browser_expanded_tool_contract(
            "browser_tabs",
            "List open browser tabs, switch to an existing tab, create a tab, or close tabs through the desktop-local Chrome/browser agent bridge. Use this for attach existing browser tab, current browser tabs, already-open pages, active tab selection, and choosing a tab id before reading page content.",
            false,
            true,
            "HIGH",
            json!({"action": "list"}),
        ),
        browser_expanded_tool_contract(
            "browser_fill",
            "Clear and fill a browser form field using a structured locator.",
            false,
            true,
            "HIGH",
            json!({"tab_id": 42, "target": {"placeholder": "Search"}, "text": "browser agent"}),
        ),
        browser_expanded_tool_contract(
            "browser_key",
            "Send a keyboard key or shortcut to the browser or a targeted element.",
            false,
            true,
            "HIGH",
            json!({"tab_id": 42, "key": "Enter"}),
        ),
        browser_expanded_tool_contract(
            "browser_select",
            "Select an option, checkbox, radio button, multi-select value, or date input in the browser.",
            false,
            true,
            "HIGH",
            json!({"tab_id": 42, "target": {"selector": "select[name=country]"}, "value": "US"}),
        ),
        browser_expanded_tool_contract(
            "browser_upload_file",
            "Attach a local file to a browser file input using a structured locator.",
            false,
            true,
            "HIGH",
            json!({"tab_id": 42, "target": {"selector": "input[type=file]"}, "path": "C:/path/file.txt"}),
        ),
        browser_expanded_tool_contract(
            "browser_downloads",
            "Inspect or wait for browser downloads and return bounded download metadata.",
            true,
            false,
            "MEDIUM",
            json!({"action": "list"}),
        ),
        browser_expanded_tool_contract(
            "browser_dialog",
            "Detect, accept, dismiss, or respond to browser alert, confirm, and prompt dialogs.",
            false,
            true,
            "HIGH",
            json!({"tab_id": 42, "action": "dismiss"}),
        ),
        browser_expanded_tool_contract(
            "browser_console_log",
            "Read recent browser console logs, warnings, and errors with source locations.",
            true,
            false,
            "MEDIUM",
            json!({"tab_id": 42, "level": "error"}),
        ),
        browser_expanded_tool_contract(
            "browser_network_log",
            "Read recent browser network requests, failures, status codes, timings, and redacted summaries.",
            true,
            false,
            "MEDIUM",
            json!({"tab_id": 42, "include_failed": true}),
        ),
        browser_expanded_tool_contract(
            "browser_storage_read",
            "Read selected browser storage values such as cookies, localStorage, sessionStorage, or IndexedDB metadata with redaction.",
            true,
            false,
            "MEDIUM",
            json!({"tab_id": 42, "area": "localStorage"}),
        ),
        browser_expanded_tool_contract(
            "browser_storage_write",
            "Write selected browser storage values such as localStorage or sessionStorage with hard approval.",
            false,
            true,
            "HIGH",
            json!({"tab_id": 42, "area": "localStorage", "key": "feature", "value": "on"}),
        ),
        browser_expanded_tool_contract(
            "browser_eval",
            "Evaluate JavaScript in the browser page context. Read-only inspection should use mode='read'; mutating eval requires hard approval.",
            false,
            true,
            "HIGH",
            json!({"tab_id": 42, "mode": "read", "code": "document.title"}),
        ),
        browser_expanded_tool_contract(
            "browser_highlight",
            "Highlight a browser element before an action or approval so the user can see the intended target.",
            false,
            true,
            "LOW",
            json!({"tab_id": 42, "target": {"text": "Continue"}}),
        ),
        browser_expanded_tool_contract(
            "browser_accessibility_audit",
            "Run local accessibility checks over labels, names, focusability, contrast hints, and keyboard reachability.",
            true,
            false,
            "MEDIUM",
            json!({"tab_id": 42}),
        ),        CoreToolContract {
            name: "browser_wait_for_element",
            description: "Ask the connected browser agent extension to wait until a target element appears in a browser tab and return the matched locator plus current page metadata.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tab_id": { "type": "integer", "description": "Browser tab identifier to target." },
                    "target": {
                        "type": "object",
                        "properties": {
                            "selector": { "type": "string" },
                            "text": { "type": "string" },
                            "role": { "type": "string" },
                            "tag_name": { "type": "string" },
                            "placeholder": { "type": "string" },
                            "index": { "type": "integer" }
                        }
                    },
                    "timeout_ms": { "type": "integer", "description": "Maximum time to wait for the element before timing out." },
                    "poll_interval_ms": { "type": "integer", "description": "Polling interval between element checks." }
                },
                "required": ["tab_id", "target", "timeout_ms", "poll_interval_ms"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "ok": {"type": "boolean"},
                    "matched": {"type": "boolean"},
                    "locator": {"type": ["object", "null"]},
                    "visible": {"type": "boolean"},
                    "url": {"type": "string"},
                    "title": {"type": "string"}
                },
                "required": ["ok", "matched", "locator", "visible", "url", "title"]
            }),
            permission_scope: &["browser_agent_read", "local_runtime"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({
                "tab_id": 42,
                "target": {"text": "Continue"},
                "timeout_ms": 10000,
                "poll_interval_ms": 250
            }),
        },
        CoreToolContract {
            name: "browser_wait_for_navigation",
            description: "Ask the connected browser agent extension to wait for navigation or page-state change in a browser tab and return the latest page metadata.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tab_id": { "type": "integer", "description": "Browser tab identifier to target." },
                    "timeout_ms": { "type": "integer", "description": "Maximum time to wait before timing out." },
                    "expected_url_contains": { "type": "string", "description": "Optional substring expected in the resulting URL." },
                    "expected_title_contains": { "type": "string", "description": "Optional substring expected in the resulting title." },
                    "wait_for_ready_state": { "type": "string", "description": "Optional ready state expectation such as loading, interactive, or complete." }
                },
                "required": ["tab_id", "timeout_ms"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "ok": {"type": "boolean"},
                    "url": {"type": "string"},
                    "title": {"type": "string"},
                    "documentReadyState": {"type": "string"},
                    "changed": {"type": "boolean"}
                },
                "required": ["ok", "url", "title", "documentReadyState", "changed"]
            }),
            permission_scope: &["browser_agent_read", "local_runtime"],
            read_only: true,
            mutating: false,
            risk_level: "LOW",
            example_arguments: json!({
                "tab_id": 42,
                "timeout_ms": 10000,
                "expected_url_contains": "/dashboard"
            }),
        },
        CoreToolContract {
            name: "browser_scroll_into_view",
            description: "Ask the connected browser agent extension to scroll a target element into view before interaction.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tab_id": { "type": "integer", "description": "Browser tab identifier to target." },
                    "target": {
                        "type": "object",
                        "properties": {
                            "selector": { "type": "string" },
                            "text": { "type": "string" },
                            "role": { "type": "string" },
                            "tag_name": { "type": "string" },
                            "placeholder": { "type": "string" },
                            "index": { "type": "integer" }
                        }
                    },
                    "align": { "type": "string", "description": "Optional scroll alignment such as start, center, end, or nearest." }
                },
                "required": ["tab_id", "target"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "ok": {"type": "boolean"},
                    "visible": {"type": "boolean"}
                },
                "required": ["ok", "visible"]
            }),
            permission_scope: &["browser_agent_write", "local_runtime"],
            read_only: false,
            mutating: true,
            risk_level: "LOW",
            example_arguments: json!({
                "tab_id": 42,
                "target": {"selector": "button.primary"},
                "align": "center"
            }),
        },
        CoreToolContract {
            name: "browser_scroll",
            description: "Ask the connected browser agent extension to scroll the browser page up or down by a pixel amount.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tab_id": { "type": "integer", "description": "Browser tab identifier to target." },
                    "direction": { "type": "string", "enum": ["up", "down"], "description": "Scroll direction." },
                    "amount": { "type": "integer", "description": "Optional positive pixel amount. Defaults to the extension's standard page scroll amount." }
                },
                "required": ["tab_id", "direction"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "ok": {"type": "boolean"}
                },
                "required": ["ok"]
            }),
            permission_scope: &["browser_agent_write", "local_runtime"],
            read_only: false,
            mutating: true,
            risk_level: "LOW",
            example_arguments: json!({
                "tab_id": 42,
                "direction": "down",
                "amount": 600
            }),
        },
        CoreToolContract {
            name: "browser_retry_with_relocate",
            description: "Retry a browser click or type action after refreshing page context, waiting for the target, and scrolling it into view.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tab_id": { "type": "integer", "description": "Browser tab identifier to target." },
                    "action_kind": { "type": "string", "enum": ["click", "type"], "description": "Action to retry once recovery has re-located the target." },
                    "target": {
                        "type": "object",
                        "properties": {
                            "selector": { "type": "string" },
                            "text": { "type": "string" },
                            "role": { "type": "string" },
                            "tag_name": { "type": "string" },
                            "placeholder": { "type": "string" },
                            "index": { "type": "integer" }
                        }
                    },
                    "text": { "type": "string", "description": "Required when action_kind is type." },
                    "max_attempts": { "type": "integer", "description": "Maximum attempts including the first execution.", "default": 2 },
                    "timeout_ms": { "type": "integer", "description": "Timeout used for re-location waiting." },
                    "poll_interval_ms": { "type": "integer", "description": "Polling interval used for re-location waiting." }
                },
                "required": ["tab_id", "action_kind", "target", "max_attempts", "timeout_ms", "poll_interval_ms"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "ok": {"type": "boolean"},
                    "attempts": {"type": "integer"},
                    "recovered": {"type": "boolean"},
                    "final_error": {"type": ["string", "null"]},
                    "last_snapshot_summary": {
                        "type": ["object", "null"],
                        "properties": {
                            "url": {"type": "string"},
                            "title": {"type": "string"},
                            "documentReadyState": {"type": "string"}
                        }
                    }
                },
                "required": ["ok", "attempts", "recovered", "final_error", "last_snapshot_summary"]
            }),
            permission_scope: &["browser_agent_write", "local_runtime"],
            read_only: false,
            mutating: true,
            risk_level: "LOW",
            example_arguments: json!({
                "tab_id": 42,
                "action_kind": "click",
                "target": {"text": "Continue"},
                "max_attempts": 2,
                "timeout_ms": 10000,
                "poll_interval_ms": 250
            }),
        },
        CoreToolContract {
            name: "browser_click",
            description: "Ask the connected browser agent extension to click an element in a browser tab using a structured locator. Use this after inspecting a page snapshot.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tab_id": { "type": "integer", "description": "Browser tab identifier to target." },
                    "target": {
                        "type": "object",
                        "properties": {
                            "selector": { "type": "string" },
                            "text": { "type": "string" },
                            "role": { "type": "string" },
                            "tag_name": { "type": "string" },
                            "index": { "type": "integer" }
                        }
                    }
                },
                "required": ["tab_id", "target"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "ok": {"type": "boolean"}
                },
                "required": ["ok"]
            }),
            permission_scope: &["browser_agent_write", "local_runtime"],
            read_only: false,
            mutating: true,
            risk_level: "LOW",
            example_arguments: json!({"tab_id": 42, "target": {"text": "Continue"}}),
        },
        CoreToolContract {
            name: "browser_type",
            description: "Ask the connected browser agent extension to type text into an element in a browser tab using a structured locator.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tab_id": { "type": "integer", "description": "Browser tab identifier to target." },
                    "target": {
                        "type": "object",
                        "properties": {
                            "selector": { "type": "string" },
                            "text": { "type": "string" },
                            "role": { "type": "string" },
                            "tag_name": { "type": "string" },
                            "index": { "type": "integer" }
                        }
                    },
                    "text": { "type": "string", "description": "Text to input into the target element." }
                },
                "required": ["tab_id", "target", "text"]
            }),
            output_schema: json!({
                "type": "object",
                "properties": {
                    "ok": {"type": "boolean"}
                },
                "required": ["ok"]
            }),
            permission_scope: &["browser_agent_write", "local_runtime"],
            read_only: false,
            mutating: true,
            risk_level: "LOW",
            example_arguments: json!({"tab_id": 42, "target": {"selector": "input[name='q']"}, "text": "browser agent"}),
        },
        terminal_context_peek_contract(),
        terminal_context_read_contract(),
        terminal_context_pack_contract(),
        terminal_write_input_contract(),
        build_shell_execute_core_tool_contract(),
        inspect_generated_artifact_contract(),
        patch_generated_artifact_contract(),
        write_docx_contract(),
        write_pptx_contract(),
    ]
}

fn terminal_context_peek_contract() -> CoreToolContract {
    CoreToolContract {
        name: "terminal_context_peek",
        description: "Read a lightweight index of the terminal context attached to this chat request. Use this first when the user's question may depend on the current terminal state, recent commands, active process, cwd, or selected terminal output. This tool is read-only and returns summaries only; call terminal_context_read when you need the output for a specific command block.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "budget": {
                    "type": "string",
                    "enum": ["tiny", "small", "medium"],
                    "description": "Optional overview size hint. V1 always returns a compact index."
                }
            }
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "available": {"type": "boolean"},
                "session_id": {"type": ["string", "null"]},
                "shell": {"type": ["string", "null"]},
                "cwd": {"type": ["string", "null"]},
                "active_process": {},
                "commands": {"type": "array"}
            },
            "required": ["available", "commands"]
        }),
        permission_scope: &["terminal_context", "local_runtime"],
        read_only: true,
        mutating: false,
        risk_level: "LOW",
        example_arguments: json!({"budget": "tiny"}),
    }
}

fn terminal_context_read_contract() -> CoreToolContract {
    CoreToolContract {
        name: "terminal_context_read",
        description: "Read terminal output from a specific target in the request-attached terminal context. Call terminal_context_peek first to choose a target. Targets include selection, last_command, last_failed_command, active_process, or a concrete command id such as cmd_3. This is read-only and bounded by max_bytes.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "description": "selection, last_command, last_failed_command, active_process, or a command id returned by terminal_context_peek."
                },
                "range": {
                    "type": "string",
                    "enum": ["tail", "head", "full"],
                    "description": "Which part of the selected output to return. Prefer tail for command failures."
                },
                "max_bytes": {
                    "type": "integer",
                    "minimum": 256,
                    "maximum": 24000,
                    "description": "Maximum bytes to return."
                }
            },
            "required": ["target"]
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "target": {"type": "string"},
                "range": {"type": "string"},
                "command": {"type": ["string", "null"]},
                "state": {"type": ["string", "null"]},
                "exit_code": {"type": ["integer", "null"]},
                "content": {"type": "string"},
                "truncated": {"type": "boolean"}
            },
            "required": ["target", "content", "truncated"]
        }),
        permission_scope: &["terminal_context", "local_runtime"],
        read_only: true,
        mutating: false,
        risk_level: "LOW",
        example_arguments: json!({"target": "last_failed_command", "range": "tail", "max_bytes": 8000}),
    }
}

fn terminal_context_pack_contract() -> CoreToolContract {
    CoreToolContract {
        name: "terminal_context_pack",
        description: "Build a compact terminal context pack for answering the current user question or handing context to another agent. It selects terminal selection first, then the most relevant failed/running/recent command. Use when you need a single bounded context bundle instead of manually reading multiple command blocks.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "goal": {
                    "type": "string",
                    "description": "What you are trying to answer or hand off."
                },
                "max_bytes": {
                    "type": "integer",
                    "minimum": 512,
                    "maximum": 32000,
                    "description": "Maximum bytes for selected context output."
                }
            }
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "goal": {"type": "string"},
                "terminal": {"type": "object"},
                "selected_context": {"type": "array"},
                "index": {"type": "object"}
            },
            "required": ["goal", "terminal", "selected_context", "index"]
        }),
        permission_scope: &["terminal_context", "local_runtime"],
        read_only: true,
        mutating: false,
        risk_level: "LOW",
        example_arguments: json!({"goal": "diagnose the user's current terminal issue", "max_bytes": 12000}),
    }
}

fn terminal_write_input_contract() -> CoreToolContract {
    CoreToolContract {
        name: "terminal_write_input",
        description: "Write text into the input buffer of the currently visible embedded desktop terminal session without executing it. Use this when you want to draft or suggest a shell command directly in that live terminal while leaving the final Enter keypress to the user. This does not run a background host command and does not create a separate execution result. The tool rejects newline characters so it cannot submit the command.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "Command text to place into the current embedded terminal session's input buffer. Newline characters are rejected."
                },
                "append_space": {
                    "type": "boolean",
                    "description": "Optional. Append one trailing space after the inserted text without executing it."
                }
            },
            "required": ["text"]
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
                "session_id": {"type": "string"},
                "text": {"type": "string"},
                "bytes_written": {"type": "integer"},
                "appended_space": {"type": "boolean"},
                "wrote_newline": {"type": "boolean"}
            },
            "required": ["ok", "session_id", "text", "bytes_written", "appended_space", "wrote_newline"]
        }),
        permission_scope: &["terminal_context", "local_runtime"],
        read_only: false,
        mutating: true,
        risk_level: "LOW",
        example_arguments: json!({"text": "bun test deeting/components/terminal", "append_space": false}),
    }
}

fn build_shell_execute_core_tool_contract() -> CoreToolContract {
    CoreToolContract {
        name: SHELL_EXECUTE_TOOL_NAME,
        description: shell_execute_tool_description(),
        input_schema: shell_execute_input_schema(),
        output_schema: shell_execute_output_schema(),
        permission_scope: &["shell_execution", "host_access"],
        read_only: false,
        mutating: true,
        risk_level: "MEDIUM",
        example_arguments: shell_execute_example_arguments(),
    }
}

fn core_tool_execution_surface(tool_name: &str) -> &'static str {
    match tool_name {
        "execute_code_plan" => "sandbox",
        "run_local_code_snippet" => "sandbox",
        "browser_open_tab" => "host",
        "browser_navigate_tab" => "host",
        "browser_find_element" => "host",
        "browser_extract" => "host",
        "browser_region_screenshot" => "host",
        "browser_full_page_screenshot" => "host",
        "browser_get_active_page" => "host",
        "browser_wait" => "host",
        "browser_tabs" => "host",
        "browser_fill" => "host",
        "browser_key" => "host",
        "browser_select" => "host",
        "browser_upload_file" => "host",
        "browser_downloads" => "host",
        "browser_dialog" => "host",
        "browser_console_log" => "host",
        "browser_network_log" => "host",
        "browser_storage_read" => "host",
        "browser_storage_write" => "host",
        "browser_eval" => "host",
        "browser_highlight" => "host",
        "browser_accessibility_audit" => "host",
        "browser_wait_for_element" => "host",
        "browser_wait_for_navigation" => "host",
        "browser_scroll_into_view" => "host",
        "browser_scroll" => "host",
        "browser_retry_with_relocate" => "host",
        "browser_click" => "host",
        "browser_type" => "host",
        "save_asset" => "sandbox",
        "shell_execute" => "sandbox",
        "inspect_generated_artifact" => "host",
        "patch_generated_artifact" => "host",
        "write_docx" => "sandbox",
        "write_pptx" => "sandbox",
        _ => "host",
    }
}

fn core_tool_risk_runtime_state(tool_name: &str) -> &'static str {
    match tool_name {
        "inspect_generated_artifact" | "patch_generated_artifact" | "write_docx" | "write_pptx" => {
            "ready"
        }
        _ => "ready",
    }
}

fn inspect_generated_artifact_contract() -> CoreToolContract {
    CoreToolContract {
        name: "inspect_generated_artifact",
        description: "Inspect a desktop-local generated DOCX/PPTX artifact and return metadata plus an editable outline for the requested or current revision. Use this before patching or revising an active generated Office artifact; it never returns raw binary file data.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "artifact_id": {
                    "type": "string",
                    "description": "Stable generated artifact id from a generated.file card or request metadata."
                },
                "file_id": {
                    "type": "string",
                    "description": "Legacy generated file id. Used only when artifact_id is unavailable."
                },
                "revision_id": {
                    "type": "string",
                    "description": "Optional revision id. Defaults to the artifact current revision."
                }
            }
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "artifact_id": {"type": "string"},
                "kind": {"type": "string", "enum": ["docx", "pptx"]},
                "title": {"type": "string"},
                "status": {"type": "string"},
                "current_revision": {"type": "object"},
                "revision": {"type": "object"},
                "file": {"type": "object"},
                "outline": {},
                "preview_text": {"type": ["string", "null"]},
                "supported_operations": {"type": "array", "items": {"type": "string"}},
                "source_available": {"type": "boolean"}
            },
            "required": ["artifact_id", "kind", "title", "current_revision", "revision", "file", "outline", "supported_operations"]
        }),
        permission_scope: &["local_state_read"],
        read_only: true,
        mutating: false,
        risk_level: "LOW",
        example_arguments: json!({"artifact_id": "generated-artifact-id"}),
    }
}

fn patch_generated_artifact_contract() -> CoreToolContract {
    CoreToolContract {
        name: "patch_generated_artifact",
        description: "Apply structured edits to an existing desktop-local generated DOCX/PPTX artifact and append a new revision. Use this for focused follow-up edits instead of regenerating the whole Office file from scratch.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "artifact_id": {
                    "type": "string",
                    "description": "Stable generated artifact id. Preferred lookup key."
                },
                "revision_id": {
                    "type": "string",
                    "description": "Revision to patch. Defaults to the artifact current revision."
                },
                "file_id": {
                    "type": "string",
                    "description": "Legacy generated file id. Used only when artifact_id/revision_id are unavailable."
                },
                "base_revision_id": {
                    "type": "string",
                    "description": "Expected current revision id for stale edit protection. Defaults to the revision being patched."
                },
                "change_summary": {
                    "type": "string",
                    "description": "Concise user-facing summary for the new revision."
                },
                "operations": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Ordered patch operations. Indexes are one-based; insert_*_after accepts 0 to insert at the beginning.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "op": {
                                "type": "string",
                                "enum": [
                                    "rename_file",
                                    "update_theme_style",
                                    "replace_title",
                                    "replace_section",
                                    "insert_section_after",
                                    "append_section",
                                    "delete_section",
                                    "replace_section_heading",
                                    "replace_paragraphs",
                                    "replace_bullets",
                                    "replace_tables",
                                    "replace_slide",
                                    "insert_slide_after",
                                    "append_slide",
                                    "delete_slide",
                                    "replace_slide_title",
                                    "replace_slide_subtitle",
                                    "replace_slide_bullets",
                                    "replace_two_column_bullets",
                                    "reorder_slides"
                                ]
                            }
                        },
                        "required": ["op"],
                        "additionalProperties": true
                    }
                }
            },
            "required": ["operations"]
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "file_id": {"type": "string"},
                "artifact_id": {"type": "string"},
                "revision_id": {"type": "string"},
                "revision_number": {"type": "integer"},
                "filename": {"type": "string"},
                "size": {"type": "integer"},
                "content_type": {"type": "string"},
                "change_summary": {"type": ["string", "null"]},
                "retention": {"type": "object"},
                "message": {"type": "string"},
                "render_blocks": {"type": "array"}
            },
            "required": ["file_id", "artifact_id", "revision_id", "revision_number", "filename", "size", "content_type", "message"]
        }),
        permission_scope: &["file_write", "local_state_read", "local_state_write"],
        read_only: false,
        mutating: true,
        risk_level: "LOW",
        example_arguments: json!({
            "artifact_id": "generated-artifact-id",
            "base_revision_id": "current-revision-id",
            "change_summary": "Updated slide 3 title",
            "operations": [
                {"op": "replace_slide_title", "slide_index": 3, "title": "Updated title"}
            ]
        }),
    }
}

fn write_docx_contract() -> CoreToolContract {
    CoreToolContract {
        name: "write_docx",
        description: write_docx_tool_description(),
        input_schema: write_docx_input_schema(),
        output_schema: json!({
            "type": "object",
            "properties": {
                "file_id": {"type": "string"},
                "artifact_id": {"type": "string"},
                "revision_id": {"type": "string"},
                "revision_number": {"type": "integer"},
                "filename": {"type": "string"},
                "size": {"type": "integer"},
                "content_type": {"type": "string"},
                "message": {"type": "string"},
                "render_blocks": {"type": "array"}
            },
            "required": ["file_id", "artifact_id", "revision_id", "revision_number", "filename", "size", "content_type", "message"]
        }),
        permission_scope: &["file_write", "local_state_write"],
        read_only: false,
        mutating: true,
        risk_level: "LOW",
        example_arguments: json!({
            "filename": "report.docx",
            "title": "季度总结",
            "sections": [
                {
                    "heading": "背景",
                    "paragraphs": [
                        {"runs": [{"text": "本项目状态："}, {"text": "按计划推进", "bold": true}]}
                    ],
                    "bullets": [
                        "关键里程碑完成",
                        {"text": "风险项持续跟踪", "level": 2}
                    ],
                    "tables": [
                        {
                            "title": "核心指标",
                            "headers": ["指标", "当前值"],
                            "rows": [["激活率", "42%"], ["留存率", "68%"]]
                        }
                    ]
                }
            ]
        }),
    }
}

fn write_pptx_contract() -> CoreToolContract {
    CoreToolContract {
        name: "write_pptx",
        description: write_pptx_tool_description(),
        input_schema: write_pptx_input_schema(),
        output_schema: json!({
            "type": "object",
            "properties": {
                "file_id": {"type": "string"},
                "artifact_id": {"type": "string"},
                "revision_id": {"type": "string"},
                "revision_number": {"type": "integer"},
                "filename": {"type": "string"},
                "size": {"type": "integer"},
                "content_type": {"type": "string"},
                "message": {"type": "string"},
                "render_blocks": {"type": "array"}
            },
            "required": ["file_id", "artifact_id", "revision_id", "revision_number", "filename", "size", "content_type", "message"]
        }),
        permission_scope: &["file_write", "local_state_write"],
        read_only: false,
        mutating: true,
        risk_level: "LOW",
        example_arguments: json!({
            "filename": "deck.pptx",
            "slides": [
                {
                    "layout": "cover",
                    "title": "项目汇报",
                    "subtitle": "2026",
                    "cover_template": "split"
                },
                {
                    "layout": "two_column",
                    "title": "本周进展",
                    "left_title": "已完成",
                    "left_bullets": ["完成 API 联调", "上线预演通过"],
                    "right_title": "下一步",
                    "right_bullets": ["推进灰度发布", "补齐监控面板"]
                }
            ]
        }),
    }
}

pub(crate) fn build_core_tool_registry_entries(
    generation: i64,
) -> Vec<LocalCapabilityRegistryUpsert> {
    let mut seen_capability_ids = HashSet::new();
    desktop_runtime_core_tools()
        .into_iter()
        .filter(|tool| seen_capability_ids.insert(format!("core.{}", tool.name)))
        .map(|tool| LocalCapabilityRegistryUpsert {
            capability_id: format!("core.{}", tool.name),
            source_kind: "core".to_string(),
            asset_kind: "core_tool".to_string(),
            package_id: CORE_TOOL_PACKAGE_ID.to_string(),
            package_version: Some("1".to_string()),
            title: tool.name.to_string(),
            description: tool.description.to_string(),
            tool_name: Some(tool.name.to_string()),
            callable_name: None,
            binding_kind: None,
            execution_surface: core_tool_execution_surface(tool.name).to_string(),
            runtime: Some(core_tool_execution_surface(tool.name).to_string()),
            entry_path: None,
            is_direct_callable: true,
            activation_state: "enabled".to_string(),
            runtime_state: core_tool_risk_runtime_state(tool.name).to_string(),
            search_index_state: "not_required".to_string(),
            generation,
            descriptor_json: json!({
                "capability_id": format!("core.{}", tool.name),
                "tool_name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
                "output_schema": tool.output_schema,
                "permission_scope": tool.permission_scope,
                "read_only": tool.read_only,
                "mutating": tool.mutating,
                "risk_level": tool.risk_level,
                "example_arguments": tool.example_arguments,
                "activation_state": "enabled",
                "runtime_state": core_tool_risk_runtime_state(tool.name),
                "search_index_state": "not_required",
                "execution_surface": core_tool_execution_surface(tool.name),
            })
            .to_string(),
        })
        .collect()
}

pub(crate) async fn sync_core_tool_registry_entries(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<i64, String> {
    let _ = store
        .delete_local_capability_registry_entries(LEGACY_CORE_TOOL_PACKAGE_ID)
        .await
        .map_err(|err| err.to_string())?;
    let generation = store
        .next_local_capability_registry_generation()
        .await
        .map_err(|err| err.to_string())?;
    let entries = build_core_tool_registry_entries(generation);
    store
        .replace_local_capability_registry_entries(CORE_TOOL_PACKAGE_ID, &entries)
        .await
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::desktop_runtime_core_tools;
    use crate::modules::execution::core_tool::{
        shell_execute_example_arguments, shell_execute_input_schema, shell_execute_output_schema,
        shell_execute_tool_description, SHELL_EXECUTE_TOOL_NAME,
    };
    use serde_json::{json, Value};

    #[test]
    fn core_tool_registry_includes_browser_agent_status() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_agent_status")
            .expect("browser_agent_status core tool should exist");

        assert!(tool.read_only);
        assert!(!tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }

    #[test]
    fn core_tool_registry_includes_browser_open_tab() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_open_tab")
            .expect("browser_open_tab core tool should exist");

        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }

    #[test]
    fn query_task_policy_description_keeps_policy_advisory() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "query_task_policy")
            .expect("query_task_policy core tool should exist");

        assert!(tool.description.contains("read-only policy retrieval"));
        assert!(tool.description.contains("must not create a new user goal"));
        assert!(tool
            .description
            .contains("replace the requested deliverable"));
    }

    #[test]
    fn core_tool_registry_includes_browser_get_page_snapshot() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_get_page_snapshot")
            .expect("browser_get_page_snapshot core tool should exist");

        assert!(tool.read_only);
        assert!(!tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }

    #[test]
    fn core_tool_registry_includes_browser_click() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_click")
            .expect("browser_click core tool should exist");

        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }

    #[test]
    fn core_tool_registry_includes_save_asset() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "save_asset")
            .expect("save_asset core tool should exist");

        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "HIGH");
    }

    #[test]
    fn core_tool_registry_includes_local_code_snippet_runner() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "run_local_code_snippet")
            .expect("run_local_code_snippet core tool should exist");

        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "MEDIUM");
    }

    #[test]
    fn core_tool_registry_reuses_shared_shell_execute_contract() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == SHELL_EXECUTE_TOOL_NAME)
            .expect("shell_execute core tool should exist");

        assert_eq!(tool.description, shell_execute_tool_description());
        assert_eq!(tool.input_schema, shell_execute_input_schema());
        assert_eq!(tool.output_schema, shell_execute_output_schema());
        assert_eq!(tool.example_arguments, shell_execute_example_arguments());
        assert_eq!(tool.permission_scope, &["shell_execution", "host_access"]);
        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "MEDIUM");
    }

    #[test]
    fn core_tool_registry_includes_terminal_write_input() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "terminal_write_input")
            .expect("terminal_write_input core tool should exist");

        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
        assert_eq!(
            tool.permission_scope,
            &["terminal_context", "local_runtime"]
        );
    }

    #[test]
    fn core_tool_registry_includes_browser_type() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_type")
            .expect("browser_type core tool should exist");

        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }

    #[test]
    fn core_tool_registry_includes_expanded_browser_tools() {
        let tools = desktop_runtime_core_tools();
        let expected = [
            ("browser_navigate_tab", false, true, "MEDIUM"),
            ("browser_find_element", true, false, "MEDIUM"),
            ("browser_extract", true, false, "MEDIUM"),
            ("browser_region_screenshot", true, false, "MEDIUM"),
            ("browser_full_page_screenshot", true, false, "MEDIUM"),
            ("browser_get_active_page", true, false, "LOW"),
            ("browser_wait", true, false, "MEDIUM"),
            ("browser_tabs", false, true, "HIGH"),
            ("browser_fill", false, true, "HIGH"),
            ("browser_key", false, true, "HIGH"),
            ("browser_select", false, true, "HIGH"),
            ("browser_upload_file", false, true, "HIGH"),
            ("browser_downloads", true, false, "MEDIUM"),
            ("browser_dialog", false, true, "HIGH"),
            ("browser_console_log", true, false, "MEDIUM"),
            ("browser_network_log", true, false, "MEDIUM"),
            ("browser_storage_read", true, false, "MEDIUM"),
            ("browser_storage_write", false, true, "HIGH"),
            ("browser_eval", false, true, "HIGH"),
            ("browser_highlight", false, true, "LOW"),
            ("browser_accessibility_audit", true, false, "MEDIUM"),
        ];

        for (name, read_only, mutating, risk_level) in expected {
            let tool = tools
                .iter()
                .find(|tool| tool.name == name)
                .unwrap_or_else(|| panic!("{name} core tool should exist"));

            assert_eq!(tool.read_only, read_only, "{name} read_only");
            assert_eq!(tool.mutating, mutating, "{name} mutating");
            assert_eq!(tool.risk_level, risk_level, "{name} risk");
        }
    }

    #[test]
    fn browser_write_tools_advertise_action_specific_discovery_terms() {
        let tools = desktop_runtime_core_tools();
        let fill = tools
            .iter()
            .find(|tool| tool.name == "browser_fill")
            .expect("browser_fill core tool should exist")
            .discovery_terms()
            .as_array()
            .expect("browser_fill discovery terms")
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ");
        let type_terms = tools
            .iter()
            .find(|tool| tool.name == "browser_type")
            .expect("browser_type core tool should exist")
            .discovery_terms()
            .as_array()
            .expect("browser_type discovery terms")
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ");
        let key = tools
            .iter()
            .find(|tool| tool.name == "browser_key")
            .expect("browser_key core tool should exist")
            .discovery_terms()
            .as_array()
            .expect("browser_key discovery terms")
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ");

        assert!(fill.contains("fill browser form"));
        assert!(fill.contains("form input"));
        assert!(fill.contains("fill social media compose box"));
        assert!(fill.contains("填写发帖框"));
        assert!(type_terms.contains("type text into browser input"));
        assert!(type_terms.contains("compose tweet text"));
        assert!(type_terms.contains("输入发帖内容"));
        assert!(key.contains("keyboard input"));
    }

    #[test]
    fn core_tool_registry_marks_browser_extract_tab_id_required() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_extract")
            .expect("browser_extract core tool should exist");

        assert_eq!(tool.input_schema["required"], json!(["tab_id"]));
        assert_eq!(
            tool.example_arguments,
            json!({"tab_id": 42, "mode": "summary"})
        );
        assert!(tool.input_schema["properties"]["target"]["description"]
            .as_str()
            .expect("target description")
            .contains("tagName"));
    }

    #[test]
    fn core_tool_registry_uses_specific_required_fields_for_expanded_browser_tools() {
        let tools = desktop_runtime_core_tools();
        let expected_required = [
            ("browser_find_element", json!(["tab_id", "target"])),
            ("browser_region_screenshot", json!(["tab_id"])),
            ("browser_full_page_screenshot", json!(["tab_id"])),
            ("browser_get_active_page", json!(null)),
            ("browser_wait", json!(["tab_id", "mode"])),
            ("browser_tabs", json!(["action"])),
            ("browser_fill", json!(["tab_id", "target", "text"])),
            ("browser_key", json!(["tab_id", "key"])),
            ("browser_select", json!(["tab_id", "target"])),
            ("browser_upload_file", json!(["tab_id", "target"])),
            ("browser_downloads", json!(null)),
            ("browser_storage_read", json!(["tab_id", "area"])),
            (
                "browser_storage_write",
                json!(["tab_id", "area", "key", "value"]),
            ),
            ("browser_eval", json!(["tab_id", "code"])),
            ("browser_highlight", json!(["tab_id", "target"])),
            ("browser_accessibility_audit", json!(["tab_id"])),
        ];

        for (name, required) in expected_required {
            let tool = tools
                .iter()
                .find(|tool| tool.name == name)
                .unwrap_or_else(|| panic!("{name} core tool should exist"));

            if required.is_null() {
                assert!(
                    tool.input_schema.get("required").is_none(),
                    "{name} should not require fields"
                );
            } else {
                assert_eq!(tool.input_schema["required"], required, "{name} required");
            }
        }
    }

    #[test]
    fn core_tool_registry_advertises_snake_case_aliases_for_normalized_fields() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_network_log")
            .expect("browser_network_log core tool should exist");

        assert!(tool.input_schema["properties"]
            .get("include_failed")
            .is_some());
        assert!(tool.input_schema["properties"]
            .get("includeFailed")
            .is_none());

        let highlight = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_highlight")
            .expect("browser_highlight core tool should exist");
        assert!(highlight.input_schema["properties"]
            .get("duration_ms")
            .is_some());
        assert!(highlight.input_schema["properties"]
            .get("durationMs")
            .is_none());
    }

    #[test]
    fn core_tool_registry_includes_browser_wait_for_element() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_wait_for_element")
            .expect("browser_wait_for_element core tool should exist");

        assert!(tool.read_only);
        assert!(!tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }

    #[test]
    fn core_tool_registry_includes_browser_wait_for_navigation() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_wait_for_navigation")
            .expect("browser_wait_for_navigation core tool should exist");

        assert!(tool.read_only);
        assert!(!tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }

    #[test]
    fn core_tool_registry_includes_browser_scroll_into_view() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_scroll_into_view")
            .expect("browser_scroll_into_view core tool should exist");

        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }

    #[test]
    fn core_tool_registry_includes_browser_scroll() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_scroll")
            .expect("browser_scroll core tool should exist");

        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }

    #[test]
    fn core_tool_registry_includes_browser_retry_with_relocate() {
        let tool = desktop_runtime_core_tools()
            .into_iter()
            .find(|tool| tool.name == "browser_retry_with_relocate")
            .expect("browser_retry_with_relocate core tool should exist");

        assert!(!tool.read_only);
        assert!(tool.mutating);
        assert_eq!(tool.risk_level, "LOW");
    }
}
