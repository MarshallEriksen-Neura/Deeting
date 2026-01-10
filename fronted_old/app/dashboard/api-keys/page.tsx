import { ApiKeysClient } from "./components/api-keys-client";

export default function ApiKeysPage() {
  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">API Keys</h1>
          <p className="text-muted-foreground">
            管理您的 API 密钥和访问令牌
          </p>
        </div>
      </div>

      <ApiKeysClient />
    </div>
  );
}
