//! Prompt surface ownership manifest.
//!
//! Prompt text is rendered by the domain that owns the semantics. This manifest
//! is the cross-module index for engineering review: it records where each
//! prompt family is assembled and which data boundary may enter it.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptSurfaceKind {
    RuntimeProtocol,
    CapabilityContract,
    ContextManifest,
    UserConfiguredPersona,
    UserDefinedAgent,
    RuntimeGeneratedAgent,
    ScheduledMonitor,
    StructuredControl,
    MemoryMaintenance,
    WorkflowPlanning,
    ApprovalRequest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptDataBoundary {
    StaticRuntimeContract,
    RuntimeAllowlist,
    UserAuthoredPrompt,
    RuntimeGeneratedPacket,
    RetrievedContextManifest,
    PersistedStateSnapshot,
    ExternalApprovalPayload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromptSurface {
    pub id: &'static str,
    pub kind: PromptSurfaceKind,
    pub owner: &'static str,
    pub entrypoint: &'static str,
    pub data_boundaries: &'static [PromptDataBoundary],
}

pub const PROMPT_SURFACE_MANIFEST: &[PromptSurface] = &[
    PromptSurface {
        id: "desktop_runtime.base_chat",
        kind: PromptSurfaceKind::RuntimeProtocol,
        owner: "desktop_runtime::runtime::prompt_definitions",
        entrypoint: "render_local_runtime_system_prompt",
        data_boundaries: &[
            PromptDataBoundary::StaticRuntimeContract,
            PromptDataBoundary::RuntimeAllowlist,
        ],
    },
    PromptSurface {
        id: "desktop_runtime.world_model",
        kind: PromptSurfaceKind::RuntimeProtocol,
        owner: "desktop_runtime::runtime::prompt_definitions",
        entrypoint: "render_world_model_system_context",
        data_boundaries: &[
            PromptDataBoundary::PersistedStateSnapshot,
            PromptDataBoundary::StaticRuntimeContract,
        ],
    },
    PromptSurface {
        id: "code_mode.capability_contract",
        kind: PromptSurfaceKind::CapabilityContract,
        owner: "code_mode::prompt",
        entrypoint: "render_runtime_capability_prompt / render_execution_tool_prompt",
        data_boundaries: &[PromptDataBoundary::RuntimeAllowlist],
    },
    PromptSurface {
        id: "desktop_runtime.context_manifest",
        kind: PromptSurfaceKind::ContextManifest,
        owner: "desktop_runtime::context_orchestrator::fsm",
        entrypoint: "render_context_manifest_prompt",
        data_boundaries: &[PromptDataBoundary::RetrievedContextManifest],
    },
    PromptSurface {
        id: "desktop_runtime.local_workflow_injections",
        kind: PromptSurfaceKind::ContextManifest,
        owner: "desktop_runtime::local_orchestrator::workflow",
        entrypoint: "PersonaPromptInjectionStep / render_skill_recipe_prompt / render_generated_artifact_context_prompt",
        data_boundaries: &[
            PromptDataBoundary::UserAuthoredPrompt,
            PromptDataBoundary::RetrievedContextManifest,
            PromptDataBoundary::PersistedStateSnapshot,
        ],
    },
    PromptSurface {
        id: "custom_task_agents.delegated_agent",
        kind: PromptSurfaceKind::UserDefinedAgent,
        owner: "custom_task_agents::prompt_definitions",
        entrypoint: "CustomTaskAgentPromptInput / render_custom_task_agent_system_prompt",
        data_boundaries: &[
            PromptDataBoundary::UserAuthoredPrompt,
            PromptDataBoundary::RetrievedContextManifest,
            PromptDataBoundary::RuntimeAllowlist,
        ],
    },
    PromptSurface {
        id: "custom_task_agents.worker_packet",
        kind: PromptSurfaceKind::RuntimeGeneratedAgent,
        owner: "custom_task_agents::prompt_definitions",
        entrypoint: "render_worker_task_packet_system_prompt / render_worker_task_packet_user_message",
        data_boundaries: &[PromptDataBoundary::RuntimeGeneratedPacket],
    },
    PromptSurface {
        id: "monitor.scheduled_task_agent",
        kind: PromptSurfaceKind::ScheduledMonitor,
        owner: "monitor::prompt_definitions",
        entrypoint: "MonitorTaskAgentPacket / MonitorTaskPromptInput / render_monitor_task_agent_message",
        data_boundaries: &[
            PromptDataBoundary::UserAuthoredPrompt,
            PromptDataBoundary::RuntimeAllowlist,
            PromptDataBoundary::PersistedStateSnapshot,
        ],
    },
    PromptSurface {
        id: "runtime.evolution_cold_start",
        kind: PromptSurfaceKind::StructuredControl,
        owner: "desktop_runtime::runtime::evolution::packet",
        entrypoint: "render_cold_start_packet_prompt",
        data_boundaries: &[PromptDataBoundary::PersistedStateSnapshot],
    },
    PromptSurface {
        id: "maintenance.memory_and_summary",
        kind: PromptSurfaceKind::MemoryMaintenance,
        owner: "conversations::summary_generation / memory::fact_extractor",
        entrypoint: "summary_prompt_template_for / fact_extraction_prompt_template_for",
        data_boundaries: &[PromptDataBoundary::PersistedStateSnapshot],
    },
    PromptSurface {
        id: "workflow.planning",
        kind: PromptSurfaceKind::WorkflowPlanning,
        owner: "workflow::proposal / workflow::plan_audit",
        entrypoint: "plan_generator_system_prompt_for / plan_audit_system_prompt_for",
        data_boundaries: &[
            PromptDataBoundary::UserAuthoredPrompt,
            PromptDataBoundary::PersistedStateSnapshot,
        ],
    },
    PromptSurface {
        id: "conversation.text_approval",
        kind: PromptSurfaceKind::ApprovalRequest,
        owner: "conversation::service",
        entrypoint: "build_text_approval_prompt",
        data_boundaries: &[PromptDataBoundary::ExternalApprovalPayload],
    },
    PromptSurface {
        id: "llm_wiki.recommended_agent",
        kind: PromptSurfaceKind::UserDefinedAgent,
        owner: "llm_wiki::templates",
        entrypoint: "build_recommended_agent_prompt",
        data_boundaries: &[PromptDataBoundary::PersistedStateSnapshot],
    },
];

pub fn prompt_surface_manifest() -> &'static [PromptSurface] {
    PROMPT_SURFACE_MANIFEST
}

#[cfg(test)]
mod tests {
    use super::{prompt_surface_manifest, PromptDataBoundary, PromptSurface};

    fn surface_by_id(id: &str) -> &'static PromptSurface {
        prompt_surface_manifest()
            .iter()
            .find(|surface| surface.id == id)
            .unwrap_or_else(|| panic!("missing prompt surface manifest entry: {}", id))
    }

    fn assert_boundaries(surface: &PromptSurface, expected: &[PromptDataBoundary]) {
        for boundary in expected {
            assert!(
                surface.data_boundaries.contains(boundary),
                "surface {} missing data boundary {:?}",
                surface.id,
                boundary
            );
        }
    }

    #[test]
    fn manifest_registers_custom_task_agent_prompt_boundary() {
        let surface = surface_by_id("custom_task_agents.delegated_agent");

        assert_eq!(surface.owner, "custom_task_agents::prompt_definitions");
        assert!(surface.entrypoint.contains("CustomTaskAgentPromptInput"));
        assert!(surface
            .entrypoint
            .contains("render_custom_task_agent_system_prompt"));
        assert_boundaries(
            surface,
            &[
                PromptDataBoundary::UserAuthoredPrompt,
                PromptDataBoundary::RetrievedContextManifest,
                PromptDataBoundary::RuntimeAllowlist,
            ],
        );
    }

    #[test]
    fn manifest_registers_worker_packet_prompt_boundary() {
        let surface = surface_by_id("custom_task_agents.worker_packet");

        assert_eq!(surface.owner, "custom_task_agents::prompt_definitions");
        assert!(surface.entrypoint.contains("render_worker_task_packet_system_prompt"));
        assert_boundaries(surface, &[PromptDataBoundary::RuntimeGeneratedPacket]);
    }

    #[test]
    fn manifest_registers_monitor_packet_prompt_boundary() {
        let surface = surface_by_id("monitor.scheduled_task_agent");

        assert_eq!(surface.owner, "monitor::prompt_definitions");
        assert!(surface.entrypoint.contains("MonitorTaskAgentPacket"));
        assert!(surface.entrypoint.contains("MonitorTaskPromptInput"));
        assert!(surface
            .entrypoint
            .contains("render_monitor_task_agent_message"));
        assert_boundaries(
            surface,
            &[
                PromptDataBoundary::UserAuthoredPrompt,
                PromptDataBoundary::RuntimeAllowlist,
                PromptDataBoundary::PersistedStateSnapshot,
            ],
        );
    }
}
