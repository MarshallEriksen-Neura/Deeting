"use client";

import { useI18n } from '@/lib/i18n-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useUpstreamProxyStatus } from '@/lib/swr/use-upstream-proxy';

/**
 * 上游代理池入口卡片（系统管理页）
 */
export function UpstreamProxyCard() {
  const { t } = useI18n();
  const router = useRouter();
  const { status, loading } = useUpstreamProxyStatus();

  const handleNavigate = () => {
    router.push('/system/admin/upstream-proxy');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-normal">
          {t('system.upstream_proxy.title')}
        </CardTitle>
        <CardDescription>
          {t('system.upstream_proxy.subtitle')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {t('system.upstream_proxy.status.total_sources')}
            </p>
            <p className="text-2xl font-light">
              {loading ? '...' : status?.total_sources ?? 0}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {t('system.upstream_proxy.status.total_endpoints')}
            </p>
            <p className="text-2xl font-light">
              {loading ? '...' : status?.total_endpoints ?? 0}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {t('system.upstream_proxy.status.available_endpoints')}
            </p>
            <p className="text-2xl font-light text-green-600">
              {loading ? '...' : status?.available_endpoints ?? 0}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {t('system.upstream_proxy.status.config_enabled')}
            </p>
            <p className="text-2xl font-light">
              {loading ? '...' : status?.config_enabled ? '✓' : '✗'}
            </p>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={handleNavigate}>
          {t('system.upstream_proxy.view_details')}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
}
