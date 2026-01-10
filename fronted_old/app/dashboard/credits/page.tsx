import { CreditsClient } from "./components/credits-client";

export default async function CreditsPage() {
  // 服务端组件 - 可以在这里预取数据，但由于需要认证，我们在客户端组件中处理
  return (
    <div className="space-y-6 max-w-7xl">
      <CreditsClient />
    </div>
  );
}
