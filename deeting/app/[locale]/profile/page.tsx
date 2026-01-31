import { UserApiKeys } from "./components/user-api-keys"
import { UserBasicInfo } from "./components/user-basic-info"
import { UserDevices } from "./components/user-devices"
import { UserMemory } from "./components/user-memory"
import { UserProfileSidebar } from "./components/user-profile-sidebar"
import { UserSecurity } from "./components/user-security"

export default function ProfilePage() {
  const apiKeys = [
    { provider: "OpenAI", status: "active", key: "sk-proj-....................8T5b", logo: "OA", color: "bg-green-100 text-green-600" },
    { provider: "DeepSeek", status: "not_configured", key: "Not Configured", logo: "DS", color: "bg-purple-100 text-purple-600" }
  ]

  const connectedDevices = [
    { agent_id: "agent_4829a1b", issued_at: "2024-01-14 10:30", expires_at: "2024-02-14", status: "active" },
    { agent_id: "agent_b73c9d2", issued_at: "2023-12-01 15:45", expires_at: "2024-01-01", status: "expired" }
  ]

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col lg:flex-row gap-8 items-start">

        {/* LEFT COLUMN: The Holographic ID Card */}
        <UserProfileSidebar />

        {/* RIGHT COLUMN: The Control Modules */}
        <main className="flex-1 space-y-6">
          <UserBasicInfo />
          <UserApiKeys apiKeys={apiKeys} />
          <UserDevices devices={connectedDevices} />
          <UserMemory memoriesCount={0} />
          <UserSecurity />
        </main>
      </div>
    </div>
  )
}