import { z } from "zod"
import { request, setAuthToken, clearAuthToken } from "@/lib/http"

const AUTH_BASE = "/api/v1/auth"

export const TokenPairSchema = z.object({
  access_token: z.string(),
  // refresh_token 由后端写入 HttpOnly Cookie，不再返回前端；兼容旧返回保留可选解析
  refresh_token: z.string().optional(),
  token_type: z.literal("bearer"),
})
export type TokenPair = z.infer<typeof TokenPairSchema>

export const MessageResponseSchema = z.object({
  message: z.string(),
})
export type MessageResponse = z.infer<typeof MessageResponseSchema>

export const SendLoginCodeSchema = z.object({
  email: z.string().email(),
  invite_code: z.string().optional(),
})
export type SendLoginCodeRequest = z.infer<typeof SendLoginCodeSchema>

export const LoginWithCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
  invite_code: z.string().optional(),
  username: z.string().optional(),
})
export type LoginWithCodeRequest = z.infer<typeof LoginWithCodeSchema>

export async function sendLoginCode(
  payload: SendLoginCodeRequest
): Promise<MessageResponse> {
  const data = await request<MessageResponse>({
    url: `${AUTH_BASE}/login/code`,
    method: "POST",
    data: payload,
  })
  return MessageResponseSchema.parse(data)
}

export async function loginWithCode(
  payload: LoginWithCodeRequest
): Promise<TokenPair> {
  const data = await request<TokenPair>({
    url: `${AUTH_BASE}/login`,
    method: "POST",
    data: payload,
  })
  const tokens = TokenPairSchema.parse(data)
  // access_token 写入内存，refresh_token 依赖后端 HttpOnly Cookie
  setAuthToken(tokens.access_token)
  return tokens
}

export async function refreshTokens(): Promise<TokenPair> {
  const data = await request<TokenPair>({
    url: `${AUTH_BASE}/refresh`,
    method: "POST",
  })
  const tokens = TokenPairSchema.parse(data)
  setAuthToken(tokens.access_token)
  return tokens
}

export async function logout(): Promise<MessageResponse> {
  const data = await request<MessageResponse>({
    url: `${AUTH_BASE}/logout`,
    method: "POST",
  })
  clearAuthToken()
  return MessageResponseSchema.parse(data)
}
