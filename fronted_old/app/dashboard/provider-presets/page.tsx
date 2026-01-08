import { PresetsClient } from "./components/presets-client";

export default function ProviderPresetsPage() {
  return (
    <div className="space-y-6 max-w-7xl">
      {/* 页面标题 */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">提供商预设管理</h1>
        <p className="text-muted-foreground text-sm">
          管理官方提供商预设配置，用户可在创建私有提供商时选择使用
        </p>
      </div>

      {/* 客户端交互组件 */}
      <PresetsClient />
    </div>
  );
}
