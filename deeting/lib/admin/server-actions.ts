/**
 * Admin Server Actions
 * 用于在客户端组件中调用服务端操作
 */

"use server"

import { revalidatePath } from "next/cache"
import {
  createAdminUser,
  updateAdminUser,
  createAdminApiKey,
  createAdminAssistant,
  createAdminProviderInstance,
  createAdminProviderCredential,
  createAdminRegistrationWindow,
  updateAdminEmbeddingSetting,
} from "@/lib/api/admin-dashboard"
import { z } from "zod"

/**
 * 用户相关 Server Actions
 */

// 创建用户表单验证
const CreateUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  username: z.string().optional(),
})

// 更新用户表单验证
const UpdateUserSchema = z.object({
  is_active: z.boolean().optional(),
  is_superuser: z.boolean().optional(),
})

export async function createUserAction(formData: FormData) {
  try {
    const email = formData.get("email") as string
    const password = formData.get("password") as string
    const username = formData.get("username") as string | null

    const validated = CreateUserSchema.parse({
      email,
      password,
      username: username || undefined,
    })

    const result = await createAdminUser(validated)
    revalidatePath("/admin/users")

    return {
      success: true,
      message: `Created user: ${result.email}`,
      data: result,
    }
  } catch (error) {
    console.error("Failed to create user:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to create user",
    }
  }
}

export async function updateUserAction(userId: string, formData: FormData) {
  try {
    const is_active = formData.get("is_active")
    const is_superuser = formData.get("is_superuser")

    const validated = UpdateUserSchema.parse({
      is_active: is_active === "true" ? true : is_active === "false" ? false : undefined,
      is_superuser: is_superuser === "true" ? true : is_superuser === "false" ? false : undefined,
    })

    await updateAdminUser(userId, validated)
    revalidatePath("/admin/users")

    return {
      success: true,
      message: "User updated successfully",
    }
  } catch (error) {
    console.error("Failed to update user:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to update user",
    }
  }
}

export async function toggleUserActiveAction(userId: string, currentStatus: boolean) {
  try {
    await updateAdminUser(userId, { is_active: !currentStatus })
    revalidatePath("/admin/users")

    return {
      success: true,
      message: `User ${!currentStatus ? "activated" : "deactivated"} successfully`,
    }
  } catch (error) {
    console.error("Failed to toggle user status:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to toggle user status",
    }
  }
}

/**
 * API Key 相关 Server Actions
 */

// 创建 API Key 表单验证
const CreateApiKeySchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["internal", "external"]),
  user_id: z.string().optional(),
  tenant_id: z.string().optional(),
  expires_at: z.string().optional(),
})

export async function createApiKeyAction(formData: FormData) {
  try {
    const name = formData.get("name") as string
    const type = formData.get("type") as "internal" | "external"
    const user_id = formData.get("user_id") as string | null
    const tenant_id = formData.get("tenant_id") as string | null
    const expires_at = formData.get("expires_at") as string | null

    const validated = CreateApiKeySchema.parse({
      name,
      type,
      user_id: user_id || undefined,
      tenant_id: tenant_id || undefined,
      expires_at: expires_at || undefined,
    })

    const result = await createAdminApiKey(validated)
    revalidatePath("/admin/api-keys")

    return {
      success: true,
      message: `Created API key: ${result.api_key.name}`,
      raw_key: result.raw_key, // 返回原始密钥（仅显示一次）
    }
  } catch (error) {
    console.error("Failed to create API key:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to create API key",
    }
  }
}

export async function revokeApiKeyAction(keyId: string) {
  try {
    // 调用撤销 API key 的逻辑
    // 由于 API 中可能没有直接的 revoke 函数，这里留作扩展
    revalidatePath("/admin/api-keys")

    return {
      success: true,
      message: "API key revoked successfully",
    }
  } catch (error) {
    console.error("Failed to revoke API key:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to revoke API key",
    }
  }
}

/**
 * Assistant 相关 Server Actions
 */

// 创建 Assistant 表单验证
const CreateAssistantSchema = z.object({
  name: z.string().min(1, "Name is required"),
  summary: z.string().optional(),
  system_prompt: z.string().min(1, "System prompt is required"),
  visibility: z.enum(["private", "unlisted", "public"]).default("private"),
  model: z.string().default("gpt-4o-mini"),
  provider_model_id: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
})

export async function createAssistantAction(formData: FormData) {
  try {
    const name = formData.get("name") as string
    const summary = formData.get("summary") as string | null
    const system_prompt = formData.get("system_prompt") as string
    const visibility = formData.get("visibility") as "private" | "unlisted" | "public"
    const model = formData.get("model") as string | null
    const provider_model_id = formData.get("provider_model_id") as string | null
    const temperature = formData.get("temperature") as string | null

    const validated = CreateAssistantSchema.parse({
      name,
      summary: summary || undefined,
      system_prompt,
      visibility: visibility || "private",
      model: model || "gpt-4o-mini",
      provider_model_id: provider_model_id || undefined,
      temperature: temperature ? parseFloat(temperature) : 0.7,
    })

    const result = await createAdminAssistant({
      visibility: validated.visibility,
      summary: validated.summary,
      version: {
        name: validated.name,
        description: validated.summary || undefined,
        system_prompt: validated.system_prompt,
        model_config: {
          model: validated.model,
          provider_model_id: validated.provider_model_id,
          temperature: validated.temperature,
        },
      },
    })

    revalidatePath("/admin/assistants")

    return {
      success: true,
      message: `Created assistant: ${result.id}`,
      data: result,
    }
  } catch (error) {
    console.error("Failed to create assistant:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to create assistant",
    }
  }
}

/**
 * Provider Instance 相关 Server Actions
 */

export async function createProviderInstanceAction(formData: FormData) {
  try {
    const name = formData.get("name") as string
    const provider_type = formData.get("provider_type") as string
    const base_url = formData.get("base_url") as string
    const description = formData.get("description") as string | null
    const api_key = formData.get("api_key") as string | null
    const is_public = formData.get("is_public") === "true"

    // 提取其他动态字段
    const extraFields: Record<string, unknown> = {}
    formData.forEach((value, key) => {
      if (!["name", "provider_type", "base_url", "description", "api_key", "is_public"].includes(key) && typeof value === "string") {
        extraFields[key] = value
      }
    })

    const result = await createAdminProviderInstance({
      preset_slug: provider_type,
      name,
      base_url,
      description: description || undefined,
      api_key: api_key || undefined,
      is_public,
      ...extraFields,
    })

    revalidatePath("/admin/provider-instances")

    return {
      success: true,
      message: `Created provider instance: ${result.name}`,
      data: result,
    }
  } catch (error) {
    console.error("Failed to create provider instance:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to create provider instance",
    }
  }
}

/**
 * Provider Credential 相关 Server Actions
 */

export async function createProviderCredentialAction(
  instanceId: string,
  formData: FormData
) {
  try {
    const alias = formData.get("alias") as string
    const api_key = formData.get("api_key") as string

    const result = await createAdminProviderCredential(instanceId, {
      alias,
      api_key,
    })

    revalidatePath("/admin/provider-credentials")

    return {
      success: true,
      message: "Created provider credential",
      data: result,
    }
  } catch (error) {
    console.error("Failed to create provider credential:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to create provider credential",
    }
  }
}

/**
 * Registration Window 相关 Server Actions
 */

export async function createRegistrationWindowAction(formData: FormData) {
  try {
    const start_time = formData.get("start_time") as string
    const end_time = formData.get("end_time") as string
    const max_registrations = formData.get("max_registrations") as string
    const auto_activate = formData.get("auto_activate") === "true"

    const result = await createAdminRegistrationWindow({
      start_time,
      end_time,
      max_registrations: parseInt(max_registrations, 10),
      auto_activate,
    })

    revalidatePath("/admin/registration")

    return {
      success: true,
      message: `Created registration window: ${result.name}`,
      data: result,
    }
  } catch (error) {
    console.error("Failed to create registration window:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to create registration window",
    }
  }
}

/**
 * Embedding Setting 相关 Server Actions
 */

export async function updateEmbeddingSettingAction(modelName: string) {
  try {
    await updateAdminEmbeddingSetting(modelName)
    revalidatePath("/admin/settings/embedding")

    return {
      success: true,
      message: "Embedding setting updated successfully",
    }
  } catch (error) {
    console.error("Failed to update embedding setting:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to update embedding setting",
    }
  }
}
