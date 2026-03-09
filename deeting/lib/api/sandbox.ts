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
  "needs_python",
  "needs_boxlite",
  "repair_needed",
  "unsupported",
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

export const SandboxPythonStatusSchema = z.object({
  installed: z.boolean(),
  abi: z.string().nullable().optional(),
  supported: z.boolean(),
  detail: z.string().nullable().optional(),
})

export const SandboxReadinessReportSchema = z.object({
  platform: z.string(),
  platform_supported: z.boolean(),
  status: SandboxReadinessStatusSchema,
  provider_name: z.string(),
  runtime_mode: SandboxRuntimeModeSchema,
  wsl: SandboxWslStatusSchema.nullish(),
  python: SandboxPythonStatusSchema.nullish(),
  boxlite: SandboxBoxLiteStatusSchema,
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

export type SandboxRuntimeMode = z.infer<typeof SandboxRuntimeModeSchema>
export type SandboxReadinessStatus = z.infer<typeof SandboxReadinessStatusSchema>
export type SandboxReadinessReport = z.infer<typeof SandboxReadinessReportSchema>
export type SandboxInstallGuide = z.infer<typeof SandboxInstallGuideSchema>

export async function getLocalSandboxStatus(): Promise<SandboxReadinessReport> {
  if (!isTauriRuntime()) {
    return SandboxReadinessReportSchema.parse({
      platform: "web",
      platform_supported: false,
      status: "unsupported",
      provider_name: "disabled",
      runtime_mode: "disabled",
      wsl: null,
      python: null,
      boxlite: {
        binary_found: false,
        binary_path: null,
        endpoint: null,
        reachable: false,
        managed_by_deeting: false,
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

export async function installLocalSandboxBoxlite(): Promise<SandboxReadinessReport> {
  const data = await invokeTauri<unknown>("install_local_sandbox_boxlite")
  return SandboxReadinessReportSchema.parse(data)
}

export async function getLocalSandboxInstallGuide(): Promise<SandboxInstallGuide> {
  const data = await invokeTauri<unknown>("get_local_sandbox_install_guide")
  return SandboxInstallGuideSchema.parse(data)
}
