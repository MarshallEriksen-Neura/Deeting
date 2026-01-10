'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Database } from 'lucide-react';
import { useI18n } from '@/lib/i18n-context';
import { useCacheMaintenance } from '@/lib/hooks/use-cache-maintenance';
import type { CacheSegment } from '@/http';

/**
 * 缓存维护卡片组件
 * 负责缓存清理操作
 */
export function CacheMaintenanceCard() {
  const { t } = useI18n();
  const { clearing, selectedSegments, toggleSegment, handleClearCache } =
    useCacheMaintenance(t);

  const cacheSegments: CacheSegment[] = [
    'models',
    'metrics_overview',
    'provider_models',
    'logical_models',
    'routing_metrics',
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('system.maintenance.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground mb-4">
            {t('system.cache_segment.select_hint')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {cacheSegments.map((segment) => (
              <label
                key={segment}
                className="flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedSegments.includes(segment)}
                  onCheckedChange={() => toggleSegment(segment)}
                />
                <span className="text-sm">
                  {t(`system.cache_segment.${segment}`)}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t">
          <Button
            variant="outline"
            size="lg"
            className="w-full md:w-auto"
            onClick={handleClearCache}
            disabled={clearing || selectedSegments.length === 0}
          >
            <Database className="w-4 h-4 mr-2" />
            {clearing
              ? t('system.maintenance.clearing')
              : t('system.maintenance.clear_cache')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
