import {
  loginWithCode,
  refreshTokens,
  sendLoginCode,
  type LoginWithCodeRequest,
  type SendLoginCodeRequest,
  type TokenPair,
} from "@/lib/api/auth"

export interface AuthService {
  sendCode: (payload: SendLoginCodeRequest) => Promise<void>
  verifyCode: (payload: LoginWithCodeRequest) => Promise<TokenPair>
  refresh: () => Promise<TokenPair>
}

export const authService: AuthService = {
  async sendCode(payload) {
    await sendLoginCode(payload)
  },

  async verifyCode(payload) {
    return loginWithCode(payload)
  },

  async refresh() {
    return refreshTokens()
  },
}
