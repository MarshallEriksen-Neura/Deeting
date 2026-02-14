// Admin Dashboard Mock Data
// All data follows the backend model schemas from the design document.
// This file will be replaced with real API calls when backend integration happens.

// ─── Helpers ────────────────────────────────────────────────
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function randomDate(daysBack: number) {
  const d = new Date()
  d.setDate(d.getDate() - Math.floor(Math.random() * daysBack))
  d.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60))
  return d.toISOString()
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ─── Dashboard Stats ────────────────────────────────────────
export const dashboardStats = {
  totalUsers: 1847,
  activeUsers24h: 312,
  totalAssistants: 89,
  publishedAssistants: 64,
  activeApiKeys: 156,
  revokedApiKeys: 23,
  requestsToday: 48520,
  successRate: 99.2,
  pendingReviews: 7,
  pendingKnowledgeReviews: 3,
  monthlySpend: 2847.56,
  totalBalance: 15420.80,
  quotaUsage: 68,
}

export const dashboardTrends = {
  users: { value: 12.5, isPositive: true },
  assistants: { value: 8.3, isPositive: true },
  apiKeys: { value: -2.1, isPositive: false },
  requests: { value: 15.7, isPositive: true },
}

export const recentErrors = [
  { time: "14:23:01", statusCode: 429, model: "gpt-4o", errorCode: "rate_limited", message: "Rate limit exceeded for provider openai" },
  { time: "14:18:45", statusCode: 503, model: "claude-3-opus", errorCode: "provider_unavailable", message: "Upstream provider timeout after 30s" },
  { time: "13:55:12", statusCode: 400, model: "dall-e-3", errorCode: "content_policy", message: "Content policy violation in image generation request" },
  { time: "13:42:30", statusCode: 500, model: "gpt-4o-mini", errorCode: "internal_error", message: "Unexpected JSON parsing error in response stream" },
  { time: "12:11:05", statusCode: 502, model: "gemini-pro", errorCode: "bad_gateway", message: "Invalid response from upstream provider" },
]

export const providerHealth = [
  { name: "OpenAI", status: "up" as const, latency: 120, sparkline: [45, 52, 48, 55, 42, 60, 55, 48, 52, 50, 55, 48] },
  { name: "Anthropic", status: "up" as const, latency: 95, sparkline: [38, 42, 35, 40, 45, 38, 42, 40, 38, 35, 42, 40] },
  { name: "Google AI", status: "degraded" as const, latency: 280, sparkline: [55, 120, 180, 220, 280, 250, 300, 280, 260, 290, 270, 280] },
  { name: "DeepSeek", status: "up" as const, latency: 155, sparkline: [60, 65, 58, 70, 62, 68, 65, 70, 62, 58, 65, 62] },
  { name: "Moonshot", status: "down" as const, latency: 0, sparkline: [50, 55, 48, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
]

// ─── Monitoring ─────────────────────────────────────────────
export const monitoringStats = {
  successRate: 99.2,
  avgTtft: 245,
  todayRequests: 48520,
  cacheHitRate: 34.8,
  costSavings: 12.5,
  requestsBlocked: 156,
  avgSpeedup: 2.3,
}

export const tokenThroughput = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, "0")}:00`,
  inputTokens: Math.floor(Math.random() * 500000) + 100000,
  outputTokens: Math.floor(Math.random() * 300000) + 50000,
}))

// ─── Users ──────────────────────────────────────────────────
export interface MockUser {
  id: string
  username: string
  email: string
  roles: string[]
  is_active: boolean
  is_superuser: boolean
  ban_until: string | null
  created_at: string
  last_login: string | null
}

const userNames = [
  "zhang_wei", "li_na", "wang_fang", "chen_ming", "liu_yang",
  "zhao_lei", "huang_jie", "wu_tao", "zhou_lin", "xu_qiang",
  "sun_ping", "ma_yun", "zhu_hua", "gao_shan", "lin_feng",
  "he_xin", "guo_rui", "luo_wen", "zheng_kai", "song_mei",
]

export const mockUsers: MockUser[] = userNames.map((name, i) => ({
  id: uuid(),
  username: name,
  email: `${name}@example.com`,
  roles: i < 3 ? ["admin"] : i < 8 ? ["editor"] : ["user"],
  is_active: i !== 5 && i !== 12,
  is_superuser: i === 0,
  ban_until: i === 5 ? "2026-03-01T00:00:00Z" : null,
  created_at: randomDate(180),
  last_login: i % 3 === 0 ? null : randomDate(7),
}))

// ─── Assistants ─────────────────────────────────────────────
export interface MockAssistant {
  id: string
  name: string
  owner: string
  visibility: "private" | "unlisted" | "public"
  status: "draft" | "published" | "archived"
  version: number
  install_count: number
  rating_avg: number
  rating_count: number
  published_at: string | null
  created_at: string
  model: string
  tags: string[]
}

const assistantNames = [
  "Code Reviewer Pro", "SQL Expert", "Translation Hub", "Writing Coach",
  "Data Analyst", "Math Tutor", "Legal Advisor", "Marketing Copy",
  "API Doc Writer", "Travel Planner", "Recipe Generator", "Fitness Coach",
  "Financial Advisor", "UX Researcher", "DevOps Helper", "Music Theory",
]

const models = ["gpt-4o", "claude-3-opus", "gpt-4o-mini", "claude-3-sonnet", "deepseek-v3", "gemini-pro"]
const tagSets = [["coding", "review"], ["database", "sql"], ["language", "translation"], ["writing"], ["data", "analytics"], ["education", "math"], ["legal"], ["marketing", "content"]]

export const mockAssistants: MockAssistant[] = assistantNames.map((name, i) => ({
  id: uuid(),
  name,
  owner: userNames[i % userNames.length],
  visibility: i < 5 ? "public" : i < 10 ? "unlisted" : "private",
  status: i < 8 ? "published" : i < 12 ? "draft" : "archived",
  version: Math.floor(Math.random() * 5) + 1,
  install_count: Math.floor(Math.random() * 500),
  rating_avg: +(3.5 + Math.random() * 1.5).toFixed(1),
  rating_count: Math.floor(Math.random() * 100),
  published_at: i < 8 ? randomDate(60) : null,
  created_at: randomDate(120),
  model: randomFrom(models),
  tags: tagSets[i % tagSets.length],
}))

// ─── Assistant Reviews ──────────────────────────────────────
export interface MockAssistantReview {
  id: string
  assistant_name: string
  submitter: string
  status: "pending" | "approved" | "rejected" | "suspended"
  submitted_at: string
  reviewer: string | null
  reviewed_at: string | null
  reason: string | null
}

export const mockAssistantReviews: MockAssistantReview[] = [
  { id: uuid(), assistant_name: "Auto Coder", submitter: "li_na", status: "pending", submitted_at: randomDate(3), reviewer: null, reviewed_at: null, reason: null },
  { id: uuid(), assistant_name: "Smart Chat", submitter: "wang_fang", status: "pending", submitted_at: randomDate(2), reviewer: null, reviewed_at: null, reason: null },
  { id: uuid(), assistant_name: "Data Viz", submitter: "chen_ming", status: "pending", submitted_at: randomDate(1), reviewer: null, reviewed_at: null, reason: null },
  { id: uuid(), assistant_name: "Email Writer", submitter: "liu_yang", status: "approved", submitted_at: randomDate(10), reviewer: "zhang_wei", reviewed_at: randomDate(8), reason: "Meets quality standards" },
  { id: uuid(), assistant_name: "Code Debug", submitter: "zhao_lei", status: "approved", submitted_at: randomDate(15), reviewer: "zhang_wei", reviewed_at: randomDate(12), reason: null },
  { id: uuid(), assistant_name: "Spam Bot", submitter: "wu_tao", status: "rejected", submitted_at: randomDate(20), reviewer: "zhang_wei", reviewed_at: randomDate(18), reason: "Contains prohibited content" },
  { id: uuid(), assistant_name: "Hack Helper", submitter: "xu_qiang", status: "suspended", submitted_at: randomDate(25), reviewer: "li_na", reviewed_at: randomDate(22), reason: "Security policy violation" },
]

// ─── Spec Knowledge Candidates ──────────────────────────────
export interface MockSpecKnowledge {
  id: string
  project_name: string
  status: "pending_signal" | "pending_eval" | "pending_review" | "approved" | "rejected"
  positive_feedback: number
  negative_feedback: number
  apply_count: number
  revert_count: number
  success_rate: number
  session_count: number
  eval_llm_score: number | null
  eval_static_pass: boolean | null
  created_at: string
}

export const mockSpecKnowledge: MockSpecKnowledge[] = [
  { id: uuid(), project_name: "react-best-practices", status: "pending_review", positive_feedback: 45, negative_feedback: 3, apply_count: 120, revert_count: 5, success_rate: 95.8, session_count: 38, eval_llm_score: 87, eval_static_pass: true, created_at: randomDate(10) },
  { id: uuid(), project_name: "python-async-patterns", status: "pending_review", positive_feedback: 32, negative_feedback: 1, apply_count: 85, revert_count: 2, success_rate: 97.6, session_count: 25, eval_llm_score: 92, eval_static_pass: true, created_at: randomDate(12) },
  { id: uuid(), project_name: "sql-optimization-tips", status: "pending_eval", positive_feedback: 18, negative_feedback: 7, apply_count: 40, revert_count: 12, success_rate: 70.0, session_count: 15, eval_llm_score: null, eval_static_pass: null, created_at: randomDate(15) },
  { id: uuid(), project_name: "docker-compose-guide", status: "approved", positive_feedback: 67, negative_feedback: 2, apply_count: 200, revert_count: 3, success_rate: 98.5, session_count: 52, eval_llm_score: 95, eval_static_pass: true, created_at: randomDate(30) },
  { id: uuid(), project_name: "css-grid-layouts", status: "pending_signal", positive_feedback: 5, negative_feedback: 0, apply_count: 12, revert_count: 0, success_rate: 100, session_count: 4, eval_llm_score: null, eval_static_pass: null, created_at: randomDate(5) },
  { id: uuid(), project_name: "jwt-auth-impl", status: "rejected", positive_feedback: 8, negative_feedback: 15, apply_count: 30, revert_count: 18, success_rate: 40.0, session_count: 10, eval_llm_score: 35, eval_static_pass: false, created_at: randomDate(25) },
]

// ─── API Keys ───────────────────────────────────────────────
export interface MockApiKey {
  id: string
  name: string
  type: "internal" | "external"
  status: "active" | "revoked" | "expired"
  user: string
  tenant_id: string | null
  expires_at: string | null
  created_at: string
  last_used: string | null
  total_requests: number
}

const apiKeyNames = [
  "Production Gateway", "Dev Testing", "Mobile App", "Partner Integration",
  "Analytics Pipeline", "CI/CD Pipeline", "Staging Env", "Load Testing",
  "Webhook Service", "Data Export", "Customer Portal", "Internal Tools",
  "Monitoring Agent", "Backup Service", "Admin Panel",
]

export const mockApiKeys: MockApiKey[] = apiKeyNames.map((name, i) => ({
  id: uuid(),
  name,
  type: i < 8 ? "internal" : "external",
  status: i === 7 ? "revoked" : i === 14 ? "expired" : "active",
  user: userNames[i % userNames.length],
  tenant_id: i >= 8 ? `tenant-${String.fromCharCode(65 + (i - 8))}` : null,
  expires_at: i < 12 ? randomDate(-90) : null, // future date
  created_at: randomDate(120),
  last_used: i % 4 === 0 ? null : randomDate(3),
  total_requests: Math.floor(Math.random() * 100000),
}))

// ─── Provider Instances ─────────────────────────────────────
export interface MockProviderInstance {
  id: string
  name: string
  preset_slug: string
  base_url: string
  priority: number
  is_enabled: boolean
  health_status: "up" | "down" | "degraded"
  latency_ms: number
  models_count: number
  sparkline: number[]
}

export const mockProviderInstances: MockProviderInstance[] = [
  { id: uuid(), name: "OpenAI Primary", preset_slug: "openai", base_url: "https://api.openai.com/v1", priority: 1, is_enabled: true, health_status: "up", latency_ms: 120, models_count: 12, sparkline: [45, 52, 48, 55, 42, 60, 55, 48, 52, 50] },
  { id: uuid(), name: "Anthropic Main", preset_slug: "anthropic", base_url: "https://api.anthropic.com/v1", priority: 2, is_enabled: true, health_status: "up", latency_ms: 95, models_count: 6, sparkline: [38, 42, 35, 40, 45, 38, 42, 40, 38, 35] },
  { id: uuid(), name: "Google AI Studio", preset_slug: "google", base_url: "https://generativelanguage.googleapis.com/v1", priority: 3, is_enabled: true, health_status: "degraded", latency_ms: 280, models_count: 8, sparkline: [55, 120, 180, 220, 280, 250, 300, 280, 260, 290] },
  { id: uuid(), name: "DeepSeek", preset_slug: "deepseek", base_url: "https://api.deepseek.com/v1", priority: 4, is_enabled: true, health_status: "up", latency_ms: 155, models_count: 4, sparkline: [60, 65, 58, 70, 62, 68, 65, 70, 62, 58] },
  { id: uuid(), name: "Moonshot AI", preset_slug: "moonshot", base_url: "https://api.moonshot.cn/v1", priority: 5, is_enabled: false, health_status: "down", latency_ms: 0, models_count: 3, sparkline: [50, 55, 48, 0, 0, 0, 0, 0, 0, 0] },
  { id: uuid(), name: "OpenAI Fallback", preset_slug: "openai", base_url: "https://api.openai.com/v1", priority: 10, is_enabled: true, health_status: "up", latency_ms: 135, models_count: 12, sparkline: [48, 50, 45, 52, 55, 48, 50, 52, 48, 45] },
]

// ─── Provider Credentials ───────────────────────────────────
export interface MockProviderCredential {
  id: string
  instance_name: string
  alias: string
  secret_ref: string
  weight: number
  priority: number
  is_active: boolean
}

export const mockProviderCredentials: MockProviderCredential[] = [
  { id: uuid(), instance_name: "OpenAI Primary", alias: "openai-key-1", secret_ref: "sk-****...a8f3", weight: 10, priority: 1, is_active: true },
  { id: uuid(), instance_name: "OpenAI Primary", alias: "openai-key-2", secret_ref: "sk-****...b2c1", weight: 5, priority: 2, is_active: true },
  { id: uuid(), instance_name: "Anthropic Main", alias: "anthropic-prod", secret_ref: "sk-ant-****...d4e5", weight: 10, priority: 1, is_active: true },
  { id: uuid(), instance_name: "Google AI Studio", alias: "google-api-key", secret_ref: "AIza****...f6g7", weight: 10, priority: 1, is_active: true },
  { id: uuid(), instance_name: "DeepSeek", alias: "deepseek-main", secret_ref: "sk-****...h8i9", weight: 10, priority: 1, is_active: true },
  { id: uuid(), instance_name: "Moonshot AI", alias: "moonshot-key", secret_ref: "sk-****...j0k1", weight: 10, priority: 1, is_active: false },
]

// ─── Provider Presets ───────────────────────────────────────
export interface MockProviderPreset {
  id: string
  slug: string
  name: string
  description: string
  status: "active" | "inactive"
  icon: string
}

export const mockProviderPresets: MockProviderPreset[] = [
  { id: uuid(), slug: "openai", name: "OpenAI", description: "GPT-4o, GPT-4o-mini, DALL-E, Whisper", status: "active", icon: "openai" },
  { id: uuid(), slug: "anthropic", name: "Anthropic", description: "Claude 3 Opus, Sonnet, Haiku", status: "active", icon: "anthropic" },
  { id: uuid(), slug: "google", name: "Google AI", description: "Gemini Pro, Gemini Ultra", status: "active", icon: "google" },
  { id: uuid(), slug: "deepseek", name: "DeepSeek", description: "DeepSeek V3, DeepSeek Coder", status: "active", icon: "deepseek" },
  { id: uuid(), slug: "moonshot", name: "Moonshot", description: "Kimi, Moonshot V1", status: "inactive", icon: "moonshot" },
  { id: uuid(), slug: "zhipu", name: "Zhipu AI", description: "GLM-4, CodeGeeX", status: "inactive", icon: "zhipu" },
]

// ─── Skills ─────────────────────────────────────────────────
export interface MockSkill {
  id: string
  name: string
  version: string
  status: "active" | "draft" | "disabled"
  runtime: string
  risk_level: "low" | "medium" | "high"
  complexity_score: number
  tags: string[]
  created_at: string
}

export const mockSkills: MockSkill[] = [
  { id: "core.tools.crawler", name: "Web Crawler", version: "1.2.0", status: "active", runtime: "opensandbox", risk_level: "medium", complexity_score: 7, tags: ["web", "scraping"], created_at: randomDate(60) },
  { id: "core.tools.code_interpreter", name: "Code Interpreter", version: "2.0.1", status: "active", runtime: "opensandbox", risk_level: "high", complexity_score: 9, tags: ["code", "execution"], created_at: randomDate(90) },
  { id: "core.tools.database", name: "Database Query", version: "1.1.0", status: "active", runtime: "opensandbox", risk_level: "high", complexity_score: 8, tags: ["database", "sql"], created_at: randomDate(80) },
  { id: "core.tools.image_gen", name: "Image Generation", version: "1.3.0", status: "active", runtime: "native", risk_level: "low", complexity_score: 5, tags: ["image", "generation"], created_at: randomDate(45) },
  { id: "core.tools.planner", name: "Task Planner", version: "1.0.0", status: "draft", runtime: "native", risk_level: "low", complexity_score: 6, tags: ["planning", "dag"], created_at: randomDate(20) },
  { id: "core.tools.vector_store", name: "Vector Store", version: "1.4.2", status: "active", runtime: "native", risk_level: "low", complexity_score: 4, tags: ["rag", "embedding"], created_at: randomDate(100) },
  { id: "core.tools.scheduler", name: "Task Scheduler", version: "0.9.0", status: "disabled", runtime: "opensandbox", risk_level: "medium", complexity_score: 7, tags: ["scheduling", "cron"], created_at: randomDate(30) },
]

// ─── Notifications ──────────────────────────────────────────
export interface MockNotification {
  id: string
  title: string
  type: "system" | "alert" | "billing" | "security" | "maintenance"
  level: "info" | "warn" | "error" | "critical"
  content: string
  target: "broadcast" | string
  created_at: string
}

export const mockNotifications: MockNotification[] = [
  { id: uuid(), title: "System Maintenance", type: "maintenance", level: "warn", content: "Scheduled maintenance window: Feb 15, 2026 02:00-04:00 UTC", target: "broadcast", created_at: randomDate(1) },
  { id: uuid(), title: "New Provider Available", type: "system", level: "info", content: "DeepSeek V3 provider is now available for all users", target: "broadcast", created_at: randomDate(3) },
  { id: uuid(), title: "Billing Alert", type: "billing", level: "warn", content: "Tenant quota usage exceeded 80% threshold", target: "tenant-A", created_at: randomDate(2) },
  { id: uuid(), title: "Security Incident", type: "security", level: "critical", content: "Unusual API key usage pattern detected from IP 203.0.113.45", target: "zhang_wei", created_at: randomDate(5) },
  { id: uuid(), title: "Rate Limit Update", type: "system", level: "info", content: "Default RPM limit increased to 60 for all users", target: "broadcast", created_at: randomDate(7) },
]

// ─── Registration ───────────────────────────────────────────
export interface MockRegistrationWindow {
  id: string
  start_time: string
  end_time: string
  max_registrations: number
  current_registrations: number
  auto_activate: boolean
  is_active: boolean
}

export const mockRegistrationWindows: MockRegistrationWindow[] = [
  { id: uuid(), start_time: "2026-02-01T00:00:00Z", end_time: "2026-02-28T23:59:59Z", max_registrations: 100, current_registrations: 43, auto_activate: true, is_active: true },
  { id: uuid(), start_time: "2026-01-01T00:00:00Z", end_time: "2026-01-31T23:59:59Z", max_registrations: 50, current_registrations: 50, auto_activate: true, is_active: false },
]

export interface MockInviteCode {
  id: string
  code: string
  status: "active" | "used" | "expired"
  expires_at: string
  used_by: string | null
  used_at: string | null
}

export const mockInviteCodes: MockInviteCode[] = [
  { id: uuid(), code: "INV-A8K3F2", status: "active", expires_at: "2026-02-28T23:59:59Z", used_by: null, used_at: null },
  { id: uuid(), code: "INV-B9L4G3", status: "active", expires_at: "2026-02-28T23:59:59Z", used_by: null, used_at: null },
  { id: uuid(), code: "INV-C0M5H4", status: "used", expires_at: "2026-02-28T23:59:59Z", used_by: "new_user_1", used_at: randomDate(5) },
  { id: uuid(), code: "INV-D1N6I5", status: "expired", expires_at: "2026-01-31T23:59:59Z", used_by: null, used_at: null },
]

// ─── Conversations (AI Business) ────────────────────────────
export interface MockConversation {
  id: string
  title: string
  user: string
  assistant: string
  channel: "internal" | "external"
  status: "active" | "closed" | "archived"
  message_count: number
  first_message_at: string
  last_active_at: string
  summary_version: number
}

export const mockConversations: MockConversation[] = Array.from({ length: 25 }, (_, i) => ({
  id: uuid(),
  title: randomFrom([
    "Help with Python debugging", "SQL query optimization", "React component design",
    "API integration support", "Data analysis request", "Code review discussion",
    "Architecture planning", "Bug investigation", "Feature brainstorming",
    "Performance tuning", "Deployment help", "Testing strategy",
  ]),
  user: randomFrom(userNames),
  assistant: randomFrom(assistantNames.slice(0, 8)),
  channel: i < 18 ? "internal" : "external",
  status: i < 15 ? "active" : i < 20 ? "closed" : "archived",
  message_count: Math.floor(Math.random() * 50) + 2,
  first_message_at: randomDate(30),
  last_active_at: randomDate(3),
  summary_version: Math.floor(Math.random() * 5),
}))

// ─── Agent Tasks (Spec Plans) ───────────────────────────────
export interface MockAgentTask {
  id: string
  project_name: string
  user: string
  status: "DRAFT" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED"
  version: number
  priority: number
  node_count: number
  completed_nodes: number
  conversation_id: string | null
  created_at: string
  duration_s: number | null
}

export const mockAgentTasks: MockAgentTask[] = [
  { id: uuid(), project_name: "Refactor auth module", user: "zhang_wei", status: "COMPLETED", version: 2, priority: 1, node_count: 8, completed_nodes: 8, conversation_id: uuid(), created_at: randomDate(5), duration_s: 342 },
  { id: uuid(), project_name: "Generate API docs", user: "li_na", status: "RUNNING", version: 1, priority: 2, node_count: 5, completed_nodes: 3, conversation_id: uuid(), created_at: randomDate(1), duration_s: null },
  { id: uuid(), project_name: "Database migration plan", user: "wang_fang", status: "RUNNING", version: 1, priority: 1, node_count: 6, completed_nodes: 2, conversation_id: null, created_at: randomDate(1), duration_s: null },
  { id: uuid(), project_name: "Frontend test suite", user: "chen_ming", status: "PAUSED", version: 3, priority: 3, node_count: 12, completed_nodes: 7, conversation_id: uuid(), created_at: randomDate(3), duration_s: null },
  { id: uuid(), project_name: "Security audit", user: "liu_yang", status: "FAILED", version: 1, priority: 1, node_count: 4, completed_nodes: 2, conversation_id: null, created_at: randomDate(4), duration_s: 180 },
  { id: uuid(), project_name: "Performance benchmark", user: "zhao_lei", status: "COMPLETED", version: 1, priority: 2, node_count: 6, completed_nodes: 6, conversation_id: uuid(), created_at: randomDate(7), duration_s: 520 },
  { id: uuid(), project_name: "Data pipeline design", user: "huang_jie", status: "DRAFT", version: 1, priority: 3, node_count: 10, completed_nodes: 0, conversation_id: null, created_at: randomDate(2), duration_s: null },
]

// ─── Generation Tasks ───────────────────────────────────────
export interface MockGenerationTask {
  id: string
  task_type: "image_generation" | "text_to_speech" | "video_generation"
  model: string
  user: string
  status: "queued" | "running" | "succeeded" | "failed" | "canceled"
  prompt: string
  width: number | null
  height: number | null
  cost_upstream: number
  cost_user: number
  input_tokens: number
  output_tokens: number
  error_code: string | null
  created_at: string
  duration_s: number | null
}

export const mockGenerationTasks: MockGenerationTask[] = [
  { id: uuid(), task_type: "image_generation", model: "dall-e-3", user: "zhang_wei", status: "succeeded", prompt: "A futuristic city skyline at sunset with flying cars", width: 1024, height: 1024, cost_upstream: 0.04, cost_user: 0.06, input_tokens: 45, output_tokens: 0, error_code: null, created_at: randomDate(2), duration_s: 12 },
  { id: uuid(), task_type: "image_generation", model: "dall-e-3", user: "li_na", status: "succeeded", prompt: "Minimalist logo design for a tech startup", width: 1024, height: 1024, cost_upstream: 0.04, cost_user: 0.06, input_tokens: 38, output_tokens: 0, error_code: null, created_at: randomDate(1), duration_s: 15 },
  { id: uuid(), task_type: "image_generation", model: "stable-diffusion-xl", user: "wang_fang", status: "running", prompt: "Watercolor painting of a Japanese garden", width: 1536, height: 1024, cost_upstream: 0.02, cost_user: 0.03, input_tokens: 42, output_tokens: 0, error_code: null, created_at: randomDate(0), duration_s: null },
  { id: uuid(), task_type: "text_to_speech", model: "tts-1-hd", user: "chen_ming", status: "succeeded", prompt: "Welcome to our platform. Let me help you get started.", width: null, height: null, cost_upstream: 0.015, cost_user: 0.025, input_tokens: 52, output_tokens: 0, error_code: null, created_at: randomDate(3), duration_s: 3 },
  { id: uuid(), task_type: "image_generation", model: "dall-e-3", user: "liu_yang", status: "failed", prompt: "Photorealistic portrait of...", width: 1024, height: 1024, cost_upstream: 0, cost_user: 0, input_tokens: 35, output_tokens: 0, error_code: "content_policy", created_at: randomDate(1), duration_s: 2 },
  { id: uuid(), task_type: "video_generation", model: "sora-v1", user: "zhao_lei", status: "queued", prompt: "A drone flyover of mountain landscape", width: 1920, height: 1080, cost_upstream: 0, cost_user: 0, input_tokens: 40, output_tokens: 0, error_code: null, created_at: randomDate(0), duration_s: null },
]

// ─── Billing ────────────────────────────────────────────────
export interface MockTenantQuota {
  id: string
  tenant_id: string
  tenant_name: string
  balance: number
  credit_limit: number
  daily_quota: number
  daily_used: number
  monthly_quota: number
  monthly_used: number
  rpm_limit: number
  tpm_limit: number
  token_quota: number
  token_used: number
  is_active: boolean
}

export const mockTenantQuotas: MockTenantQuota[] = [
  { id: uuid(), tenant_id: "tenant-A", tenant_name: "Acme Corp", balance: 5420.50, credit_limit: 10000, daily_quota: 10000, daily_used: 4523, monthly_quota: 200000, monthly_used: 89432, rpm_limit: 120, tpm_limit: 200000, token_quota: 5000000, token_used: 2345678, is_active: true },
  { id: uuid(), tenant_id: "tenant-B", tenant_name: "TechStart Inc", balance: 1250.30, credit_limit: 5000, daily_quota: 5000, daily_used: 1234, monthly_quota: 100000, monthly_used: 34567, rpm_limit: 60, tpm_limit: 100000, token_quota: 2000000, token_used: 890123, is_active: true },
  { id: uuid(), tenant_id: "tenant-C", tenant_name: "DataFlow Ltd", balance: 8900.00, credit_limit: 20000, daily_quota: 20000, daily_used: 8765, monthly_quota: 500000, monthly_used: 234567, rpm_limit: 240, tpm_limit: 500000, token_quota: 10000000, token_used: 5678901, is_active: true },
  { id: uuid(), tenant_id: "tenant-D", tenant_name: "SmallBiz Co", balance: 23.45, credit_limit: 500, daily_quota: 1000, daily_used: 890, monthly_quota: 20000, monthly_used: 18500, rpm_limit: 30, tpm_limit: 50000, token_quota: 500000, token_used: 478000, is_active: true },
  { id: uuid(), tenant_id: "tenant-E", tenant_name: "Expired Corp", balance: 0, credit_limit: 1000, daily_quota: 2000, daily_used: 0, monthly_quota: 50000, monthly_used: 0, rpm_limit: 60, tpm_limit: 100000, token_quota: 1000000, token_used: 0, is_active: false },
]

export interface MockBillingTransaction {
  id: string
  trace_id: string
  tenant_name: string
  type: "deduct" | "recharge" | "refund" | "adjust"
  status: "pending" | "committed" | "reversed"
  amount: number
  input_tokens: number
  output_tokens: number
  model: string
  provider: string
  balance_before: number
  balance_after: number
  description: string
  created_at: string
}

export const mockBillingTransactions: MockBillingTransaction[] = Array.from({ length: 30 }, (_, i) => {
  const type = randomFrom(["deduct", "deduct", "deduct", "deduct", "recharge", "refund", "adjust"] as const)
  const amount = type === "recharge" ? +(Math.random() * 500 + 100).toFixed(2) : type === "deduct" ? +(Math.random() * 2 + 0.01).toFixed(4) : +(Math.random() * 10).toFixed(2)
  const balBefore = +(Math.random() * 10000 + 100).toFixed(2)
  return {
    id: uuid(),
    trace_id: `tx-${Date.now()}-${i}`,
    tenant_name: randomFrom(["Acme Corp", "TechStart Inc", "DataFlow Ltd", "SmallBiz Co"]),
    type,
    status: i < 25 ? "committed" : i < 28 ? "pending" : "reversed",
    amount,
    input_tokens: type === "deduct" ? Math.floor(Math.random() * 5000) + 100 : 0,
    output_tokens: type === "deduct" ? Math.floor(Math.random() * 3000) + 50 : 0,
    model: type === "deduct" ? randomFrom(models) : "",
    provider: type === "deduct" ? randomFrom(["openai", "anthropic", "google", "deepseek"]) : "",
    balance_before: balBefore,
    balance_after: type === "deduct" ? +(balBefore - amount).toFixed(2) : +(balBefore + amount).toFixed(2),
    description: type === "recharge" ? "Manual top-up" : type === "refund" ? "Service credit" : type === "adjust" ? "Quota adjustment" : "API call",
    created_at: randomDate(30),
  }
})

// ─── Gateway Logs ───────────────────────────────────────────
export interface MockGatewayLog {
  id: string
  trace_id: string
  user: string
  api_key_name: string
  model: string
  status_code: number
  duration_ms: number
  ttft_ms: number
  input_tokens: number
  output_tokens: number
  cost_upstream: number
  cost_user: number
  is_cached: boolean
  error_code: string | null
  upstream_url: string
  retry_count: number
  created_at: string
}

export const mockGatewayLogs: MockGatewayLog[] = Array.from({ length: 50 }, (_, i) => {
  const model = randomFrom(models)
  const statusCode = i < 40 ? 200 : randomFrom([400, 429, 500, 502, 503])
  return {
    id: uuid(),
    trace_id: `gw-${Date.now()}-${i}`,
    user: randomFrom(userNames),
    api_key_name: randomFrom(apiKeyNames.slice(0, 8)),
    model,
    status_code: statusCode,
    duration_ms: statusCode === 200 ? Math.floor(Math.random() * 3000) + 100 : Math.floor(Math.random() * 500) + 50,
    ttft_ms: statusCode === 200 ? Math.floor(Math.random() * 500) + 50 : 0,
    input_tokens: Math.floor(Math.random() * 5000) + 100,
    output_tokens: statusCode === 200 ? Math.floor(Math.random() * 3000) + 50 : 0,
    cost_upstream: +(Math.random() * 0.5).toFixed(4),
    cost_user: +(Math.random() * 0.8).toFixed(4),
    is_cached: Math.random() > 0.65,
    error_code: statusCode !== 200 ? randomFrom(["rate_limited", "provider_unavailable", "content_policy", "bad_gateway", "internal_error"]) : null,
    upstream_url: `https://api.${randomFrom(["openai", "anthropic", "google", "deepseek"])}.com/v1/chat/completions`,
    retry_count: statusCode !== 200 ? Math.floor(Math.random() * 3) : 0,
    created_at: randomDate(7),
  }
})

// ─── Knowledge Reviews ──────────────────────────────────────
export interface MockKnowledgeArtifact {
  id: string
  title: string
  source_url: string | null
  artifact_type: "documentation" | "assistant" | "provider_spec"
  status: "pending" | "processing" | "indexed" | "failed"
  embedding_model: string
  chunks_count: number
  content_hash: string
  created_at: string
}

export const mockKnowledgeArtifacts: MockKnowledgeArtifact[] = [
  { id: uuid(), title: "Next.js App Router Guide", source_url: "https://nextjs.org/docs", artifact_type: "documentation", status: "indexed", embedding_model: "text-embedding-3-small", chunks_count: 245, content_hash: "a8f3c2d1...", created_at: randomDate(30) },
  { id: uuid(), title: "FastAPI Best Practices", source_url: "https://fastapi.tiangolo.com", artifact_type: "documentation", status: "indexed", embedding_model: "text-embedding-3-small", chunks_count: 180, content_hash: "b9e4d3c2...", created_at: randomDate(25) },
  { id: uuid(), title: "Code Reviewer Pro Context", source_url: null, artifact_type: "assistant", status: "indexed", embedding_model: "text-embedding-3-small", chunks_count: 45, content_hash: "c0f5e4d3...", created_at: randomDate(15) },
  { id: uuid(), title: "OpenAI API Spec", source_url: "https://platform.openai.com/docs", artifact_type: "provider_spec", status: "processing", embedding_model: "text-embedding-3-small", chunks_count: 0, content_hash: "d1a6f5e4...", created_at: randomDate(1) },
  { id: uuid(), title: "PostgreSQL Optimization", source_url: "https://wiki.postgresql.org", artifact_type: "documentation", status: "pending", embedding_model: "text-embedding-3-small", chunks_count: 0, content_hash: "e2b7a6f5...", created_at: randomDate(0) },
  { id: uuid(), title: "Failed Import Doc", source_url: "https://broken-link.example.com", artifact_type: "documentation", status: "failed", embedding_model: "text-embedding-3-small", chunks_count: 0, content_hash: "f3c8b7a6...", created_at: randomDate(3) },
]

// ─── Settings ───────────────────────────────────────────────
export const mockEmbeddingSettings = {
  current_model: "text-embedding-3-small",
  available_models: [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
  ],
}
