import { z } from "zod"

import { request } from "@/lib/http"
import {
  openDesktopOAuthAuthorizeUrl,
  type DesktopOAuthExchangeRequest,
  type DesktopOAuthProvider,
  type DesktopOAuthStartResponse,
} from "@/lib/api/auth-oauth-desktop"

export const ACCOUNT_BINDINGS_KEY = "/api/v1/users/me/bindings"

const OAuthBindingStateSchema = z.object({
  is_bound: z.boolean(),
  display_name: z.string().nullable(),
  bound_at: z.string().nullable(),
})

const EmailBindingAliasSchema = z.object({
  email: z.string().email(),
  bound_at: z.string().nullable(),
})

export const AccountBindingsSchema = z.object({
  oauth: z.object({
    google: OAuthBindingStateSchema,
    github: OAuthBindingStateSchema,
  }),
  email: z.object({
    primary_email: z.string().email(),
    aliases: z.array(EmailBindingAliasSchema),
  }),
})

export type AccountBindings = z.infer<typeof AccountBindingsSchema>

export const OAuthBindingConfirmResponseSchema = z.object({
  provider: z.enum(["google", "github"]),
  is_bound: z.boolean(),
  display_name: z.string().nullable(),
})

export type OAuthBindingConfirmResponse = z.infer<
  typeof OAuthBindingConfirmResponseSchema
>

export async function fetchAccountBindings(): Promise<AccountBindings> {
  const data = await request<AccountBindings>({
    url: ACCOUNT_BINDINGS_KEY,
    method: "GET",
  })
  return AccountBindingsSchema.parse(data)
}

export async function sendEmailBindingCode(email: string): Promise<void> {
  await request({
    url: `${ACCOUNT_BINDINGS_KEY}/email/send-code`,
    method: "POST",
    data: { email },
  })
}

export async function confirmEmailBinding(
  email: string,
  code: string
): Promise<void> {
  await request({
    url: `${ACCOUNT_BINDINGS_KEY}/email/confirm`,
    method: "POST",
    data: { email, code },
  })
}

export async function startDesktopOAuthBindingSession(
  provider: DesktopOAuthProvider
): Promise<DesktopOAuthStartResponse> {
  return request<DesktopOAuthStartResponse>({
    url: "/api/v1/auth/oauth/desktop/bind/start",
    method: "POST",
    data: {
      provider,
      return_scheme: "deeting",
      platform: "desktop",
    },
  })
}

export async function openDesktopOAuthBinding(provider: DesktopOAuthProvider): Promise<void> {
  const session = await startDesktopOAuthBindingSession(provider)
  await openDesktopOAuthAuthorizeUrl(session.authorize_url)
}

export async function confirmDesktopOAuthBindingGrant(
  payload: DesktopOAuthExchangeRequest
): Promise<OAuthBindingConfirmResponse> {
  const data = await request<OAuthBindingConfirmResponse>({
    url: "/api/v1/auth/oauth/desktop/bind/confirm",
    method: "POST",
    data: payload,
  })
  return OAuthBindingConfirmResponseSchema.parse(data)
}
