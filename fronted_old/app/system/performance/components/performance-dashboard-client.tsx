'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  getStoredMetrics, 
  clearStoredMetrics, 
  getPerformanceSummary,
  type PerformanceMetric 
} from '@/lib/utils/performance';
import { Activity, TrendingUp, TrendingDown, Minus, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n-context';

export function PerformanceDashboardClient() {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [summary, setSummary] = useState<ReturnType<typeof getPerformanceSummary>>(null);

  const loadMetrics = () => {
    const stored = getStoredMetrics();
    setMetrics(stored);
    setSummary(getPerformanceSummary());
  };

  useEffect(() => {
    loadMetrics();
  }, []);

  const handleClear = () => {
    if (confirm(t('performance.clear_confirm'))) {
      clearStoredMetrics();
      loadMetrics();
    }
  };

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case 'good':
        return 'text-green-600 dark:text-green-400';
      case 'needs-improvement':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'poor':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-muted-foreground';
    }
  };

  const getRatingIcon = (rating: string) => {
    switch (rating) {
      case 'good':
        return <TrendingUp className="h-4 w-4" />;
      case 'needs-improvement':
        return <Minus className="h-4 w-4" />;
      case 'poor':
        return <TrendingDown className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getRatingText = (rating: string) => {
    switch (rating) {
      case 'good':
        return t('performance.rating.good');
      case 'needs-improvement':
        return t('performance.rating.needs_improvement');
      case 'poor':
        return t('performance.rating.poor');
      default:
        return rating;
    }
  };

  const formatValue = (name: string, value: number) => {
    // CLS 是无单位的分数
    if (name === 'CLS') {
      return value.toFixed(3);
    }
    // 其他指标是毫秒
    return `${Math.round(value)}ms`;
  };

  const getMetricDescription = (name: string) => {
    const key = `performance.metric.${name.toLowerCase()}.desc`;
    return t(key);
  };

  if (!summary || summary.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('performance.no_data_title')}</CardTitle>
          <CardDescription>
            {t('performance.no_data_description')}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-3xl font-bold mb-2">{t('performance.title')}</h1>
        <p className="text-muted-foreground">
          {t('performance.subtitle')}
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <Button onClick={loadMetrics} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('performance.refresh_data')}
        </Button>
        <Button onClick={handleClear} variant="outline" size="sm">
          <Trash2 className="h-4 w-4 mr-2" />
          {t('performance.clear_data')}
        </Button>
      </div>

      {/* 性能指标卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {summary.map((metric) => (
          <Card key={metric.name}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  {metric.name}
                </CardTitle>
                <div className={getRatingColor(metric.rating)}>
                  {getRatingIcon(metric.rating)}
                </div>
              </div>
              <CardDescription className="text-xs">
                {getMetricDescription(metric.name)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">
                    {formatValue(metric.name, metric.average)}
                  </span>
                  <span className={`text-xs font-medium ${getRatingColor(metric.rating)}`}>
                    {getRatingText(metric.rating)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>{t('performance.metric.min')}:</span>
                    <span>{formatValue(metric.name, metric.min)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('performance.metric.max')}:</span>
                    <span>{formatValue(metric.name, metric.max)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('performance.metric.samples')}:</span>
                    <span>{metric.count}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 最近的指标记录 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('performance.recent_records')}</CardTitle>
          <CardDescription>
            {t('performance.recent_records_description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {metrics.slice(-20).reverse().map((metric, index) => (
              <div
                key={`${metric.id}-${index}`}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-medium w-12">
                    {metric.name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {getMetricDescription(metric.name)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">
                    {formatValue(metric.name, metric.value)}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${getRatingColor(metric.rating)}`}>
                    {metric.rating}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 性能指标说明 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('performance.metrics_explanation')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <strong>{t('performance.metric.cls')} ({t('performance.metric.cls.desc')})</strong>
            <p className="text-muted-foreground">
              {t('performance.metric.cls.explanation')}
            </p>
          </div>
          <div>
            <strong>{t('performance.metric.fcp')} ({t('performance.metric.fcp.desc')})</strong>
            <p className="text-muted-foreground">
              {t('performance.metric.fcp.explanation')}
            </p>
          </div>
          <div>
            <strong>{t('performance.metric.inp')} ({t('performance.metric.inp.desc')})</strong>
            <p className="text-muted-foreground">
              {t('performance.metric.inp.explanation')}
            </p>
          </div>
          <div>
            <strong>{t('performance.metric.lcp')} ({t('performance.metric.lcp.desc')})</strong>
            <p className="text-muted-foreground">
              {t('performance.metric.lcp.explanation')}
            </p>
          </div>
          <div>
            <strong>{t('performance.metric.ttfb')} ({t('performance.metric.ttfb.desc')})</strong>
            <p className="text-muted-foreground">
              {t('performance.metric.ttfb.explanation')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
