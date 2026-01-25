import { MCPRegistryClient } from "@/components/mcp/mcp-registry-client"
export default function MCPRegistryPage() {
  return (
    <MCPRegistryClient 
      initialTools={[]} 
      initialSources={[]} 
    />
  )
}
