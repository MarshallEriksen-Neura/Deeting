import { useState } from 'react';
import { systemService, type CacheSegment } from '@/http';
import { toast } from 'sonner';

/**
 * 管理缓存维护操作的自定义 Hook
 */
export function useCacheMaintenance(t: (key: string) => string) {
  const [clearing, setClearing] = useState(false);
  const [selectedSegments, setSelectedSegments] = useState<CacheSegment[]>([
    'models',
    'metrics_overview',
    'provider_models',
    'logical_models',
    'routing_metrics',
  ]);

  const toggleSegment = (segment: CacheSegment) => {
    setSelectedSegments((prev) =>
      prev.includes(segment)
        ? prev.filter((item) => item !== segment)
        : [...prev, segment]
    );
  };

  const handleClearCache = async () => {
    if (!selectedSegments.length) {
      toast.error(t('system.cache_segment.none_selected'));
      return;
    }
    try {
      setClearing(true);
      await systemService.clearCache(selectedSegments);
      toast.success(t('system.maintenance.clear_cache_success'));
    } catch (e: any) {
      const message =
        e?.response?.data?.detail ||
        e?.message ||
        t('system.maintenance.clear_cache_error');
      toast.error(message);
    } finally {
      setClearing(false);
    }
  };

  return {
    clearing,
    selectedSegments,
    toggleSegment,
    handleClearCache,
  };
}
