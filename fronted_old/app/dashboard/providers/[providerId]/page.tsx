import { ProviderDetailClientWrapper } from "@/components/dashboard/providers/provider-detail-client-wrapper";

interface ProviderDetailPageProps {
  params: Promise<{
    providerId: string;
  }>;
}

export default async function ProviderDetailPage({ params }: ProviderDetailPageProps) {
  // Next.js 15 中 params 是 Promise，这里先解包再使用
  const { providerId } = await params;

  return (
    <ProviderDetailClientWrapper
      providerId={providerId}
    />
  );
}
