import { MCPRegistryClient } from "@/components/mcp/mcp-registry-client"
import { INITIAL_TOOLS, INITIAL_SOURCES } from "@/constants/mcp-defaults"

export default function MCPRegistryPage() {
  return (
    <MCPRegistryClient 
      initialTools={INITIAL_TOOLS} 
      initialSources={INITIAL_SOURCES} 
    />
  )
}