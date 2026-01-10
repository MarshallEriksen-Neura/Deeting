"use client";

import { useI18n } from '@/lib/i18n-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { useUpstreamProxyStatus, useUpstreamProxyTasks } from '@/lib/swr/use-upstream-proxy';

/**
 * 代理池状态卡片
 */
export function UpstreamProxyStatusCard() {
  const { t } = useI18n();
  const { status, loading, error, refresh } = useUpstreamProxyStatus();
  const { triggerRefresh, triggerHealthCheck, refreshing, checking } = useUpstreamProxyTasks();

  const handleRefresh = async () => {
    try {
      const result = await triggerRefresh();
      toast.success(t('system.upstream_proxy.actions.refresh_success'));
      toast.info(t('system.upstream_proxy.actions.task_submitted').replace('{taskId}', result.task_id));
      setTimeout(() => refresh(), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleHealthCheck = async () => {
    try {
      const result = await triggerHealthCheck();
      toast.success(t('system.upstream_proxy.actions.check_success'));
      toast.info(t('system.upstream_proxy.actions.task_submitted').replace('{taskId}', result.task_id));
      setTimeout(() => refresh(), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-normal">
          {t('system.upstream_proxy.status.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* 状态指标 */}
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

        {/* 操作按钮 */}
        <div className="flex gap-3 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing || loading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('system.upstream_proxy.actions.refresh_sources')}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleHealthCheck}
            disabled={checking || loading}
          >
            <Activity className="h-4 w-4 mr-2" />
            {t('system.upstream_proxy.actions.check_health')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
