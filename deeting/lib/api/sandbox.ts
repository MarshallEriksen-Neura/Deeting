import { z } from "zod"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const SandboxRuntimeModeSchema = z.enum([
  "sandbox",
  "host_fallback",
  "disabled",
])

export const SandboxReadinessStatusSchema = z.enum([
  "ready",
  "needs_wsl",
  "needs_boxlite",
  "repair_needed",
  "unsupported",
])

export const SandboxExecutionProbeStatusSchema = z.enum([
  "passed",
  "failed",
  "skipped",
])

export const SandboxSnippetLanguageSchema = z.enum([
  "python",
  "go",
  "rust",
  "java",
])

export const SandboxWslStatusSchema = z.object({
  installed: z.boolean(),
  ready: z.boolean(),
  detail: z.string().nullable().optional(),
  recommended_command: z.string().nullable().optional(),
})

export const SandboxBoxLiteStatusSchema = z.object({
  binary_found: z.boolean(),
  binary_path: z.string().nullable().optional(),
  endpoint: z.string().nullable().optional(),
  reachable: z.boolean(),
  managed_by_deeting: z.boolean(),
})

export const SandboxExecutionProbeSchema = z.object({
  status: SandboxExecutionProbeStatusSchema,
  detail: z.string().nullable().optional(),
  checked_at_unix_ms: z.number().nullable().optional(),
})

export const SandboxReadinessReportSchema = z.object({
  platform: z.string(),
  platform_supported: z.boolean(),
  status: SandboxReadinessStatusSchema,
  provider_name: z.string(),
  runtime_mode: SandboxRuntimeModeSchema,
  wsl: SandboxWslStatusSchema.nullish(),
  boxlite: SandboxBoxLiteStatusSchema,
  execution_probe: SandboxExecutionProbeSchema,
  blocking_reason: z.string().nullable().optional(),
  next_actions: z.array(z.string()).default([]),
  can_auto_prepare: z.boolean(),
})

export const SandboxInstallGuideSchema = z.object({
  status: SandboxReadinessStatusSchema,
  title: z.string(),
  description: z.string(),
  steps: z.array(z.string()).default([]),
  primary_command: z.string().nullable().optional(),
})

export const SandboxSnippetRunResponseSchema = z.object({
  success: z.boolean(),
  status: z.string(),
  language: SandboxSnippetLanguageSchema,
  image: z.string(),
  sandbox_id: z.string().nullable().optional(),
  runtime_mode: SandboxRuntimeModeSchema,
  stdout: z.array(z.string()).default([]),
  stderr: z.array(z.string()).default([]),
  result: z.array(z.string()).default([]),
  exit_code: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  readiness: SandboxReadinessReportSchema.nullish(),
})

export type SandboxRuntimeMode = z.infer<typeof SandboxRuntimeModeSchema>
export type SandboxReadinessStatus = z.infer<typeof SandboxReadinessStatusSchema>
export type SandboxExecutionProbeStatus = z.infer<typeof SandboxExecutionProbeStatusSchema>
export type SandboxSnippetLanguage = z.infer<typeof SandboxSnippetLanguageSchema>
export type SandboxReadinessReport = z.infer<typeof SandboxReadinessReportSchema>
export type SandboxInstallGuide = z.infer<typeof SandboxInstallGuideSchema>
export type SandboxSnippetRunResponse = z.infer<typeof SandboxSnippetRunResponseSchema>

export async function getLocalSandboxStatus(): Promise<SandboxReadinessReport> {
  if (!isTauriRuntime()) {
    return SandboxReadinessReportSchema.parse({
      platform: "web",
      platform_supported: false,
      status: "unsupported",
      provider_name: "disabled",
      runtime_mode: "disabled",
      wsl: null,
      boxlite: {
        binary_found: false,
        binary_path: null,
        endpoint: null,
        reachable: false,
        managed_by_deeting: false,
      },
      execution_probe: {
        status: "skipped",
        detail: "Sandbox execution probe is only available in the desktop app.",
        checked_at_unix_ms: null,
      },
      blocking_reason: "Sandbox status is only available in the desktop app.",
      next_actions: [],
      can_auto_prepare: false,
    })
  }

  const data = await invokeTauri<unknown>("get_local_sandbox_status")
  return SandboxReadinessReportSchema.parse(data)
}

export async function prepareLocalSandbox(): Promise<SandboxReadinessReport> {
  const data = await invokeTauri<unknown>("prepare_local_sandbox")
  return SandboxReadinessReportSchema.parse(data)
}

export async function repairLocalSandbox(): Promise<SandboxReadinessReport> {
  const data = await invokeTauri<unknown>("repair_local_sandbox")
  return SandboxReadinessReportSchema.parse(data)
}

export async function rebuildLocalSandboxRuntime(): Promise<SandboxReadinessReport> {
  const data = await invokeTauri<unknown>("rebuild_local_sandbox_runtime")
  return SandboxReadinessReportSchema.parse(data)
}

export async function installLocalSandboxBoxlite(): Promise<SandboxReadinessReport> {
  const data = await invokeTauri<unknown>("install_local_sandbox_boxlite")
  return SandboxReadinessReportSchema.parse(data)
}

export async function getLocalSandboxInstallGuide(): Promise<SandboxInstallGuide> {
  const data = await invokeTauri<unknown>("get_local_sandbox_install_guide")
  return SandboxInstallGuideSchema.parse(data)
}

export async function runLocalSandboxCodeSnippet(payload: {
  sessionId: string
  language: SandboxSnippetLanguage
  code: string
  executionTimeoutSecs?: number
}): Promise<SandboxSnippetRunResponse> {
  const data = await invokeTauri<unknown>("run_local_sandbox_code_snippet", {
    payload: {
      session_id: payload.sessionId,
      language: payload.language,
      code: payload.code,
      execution_timeout_secs: payload.executionTimeoutSecs,
    },
  })
  return SandboxSnippetRunResponseSchema.parse(data)
}

const SandboxImageRegistriesSchema = z.array(z.string())

/**
 * List custom OCI image registry mirrors that BoxLite should try (in order)
 * when pulling unqualified images. Returns an empty array if none are set.
 */
export async function getLocalSandboxImageRegistries(): Promise<string[]> {
  if (!isTauriRuntime()) return []
  const data = await invokeTauri<unknown>("get_local_sandbox_image_registries")
  return SandboxImageRegistriesSchema.parse(data)
}

/**
 * Persist the list of OCI image registry mirrors. Server normalizes the list
 * (trim + dedupe + preserve order) and returns the canonical form.
 *
 * Note: the new list only takes effect after the BoxLite server is restarted,
 * e.g., via repairLocalSandbox or rebuildLocalSandboxRuntime.
 */
export async function setLocalSandboxImageRegistries(
  registries: string[]
): Promise<string[]> {
  const data = await invokeTauri<unknown>(
    "set_local_sandbox_image_registries",
    { registries }
  )
  return SandboxImageRegistriesSchema.parse(data)
}
