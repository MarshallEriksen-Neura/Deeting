import { MCPRegistryClient } from "@/components/mcp/mcp-registry-client";

export default function McpPage() {
  return (
    <div className="relative h-full w-full overflow-auto">
      <div className="mx-auto max-w-[1200px] p-6">
        <MCPRegistryClient />
      </div>
    </div>
  );
}
