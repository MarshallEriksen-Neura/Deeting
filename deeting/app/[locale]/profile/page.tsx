import { UserApiKeys } from "./components/user-api-keys"
import { UserAccountBindings } from "./components/user-account-bindings"
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

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col lg:flex-row gap-8 items-start">

        {/* LEFT COLUMN: The Holographic ID Card */}
        <UserProfileSidebar />

        {/* RIGHT COLUMN: The Control Modules */}
        <main className="flex-1 space-y-6">
          <UserBasicInfo />
          <UserApiKeys apiKeys={apiKeys} />
          <UserDevices />
          <UserMemory memoriesCount={0} />
          <UserAccountBindings />
          <UserSecurity />
        </main>
      </div>
    </div>
  )
}
