"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { MetricsResponse } from "@/http/provider";

interface ProviderMetricsTabProps {
  metrics?: MetricsResponse;
  translations: {
    title: string;
    description: string;
    noMetrics: string;
    lastUpdated: string;
    requests: string;
    successRate: string;
    p95Latency: string;
    p99Latency: string;
  };
}

export const ProviderMetricsTab = ({ metrics, translations }: ProviderMetricsTabProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translations.title}</CardTitle>
        <CardDescription>{translations.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!metrics?.metrics || metrics.metrics.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {translations.noMetrics}
          </div>
        ) : (
          <div className="space-y-4">
            {metrics.metrics.map((metric, index) => (
              <div key={index} className="p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">{metric.logical_model}</div>
                  <div className="text-xs text-muted-foreground">
                    {translations.lastUpdated}: {new Date(metric.last_updated * 1000).toLocaleTimeString()}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">{translations.requests}</div>
                    <div className="font-mono">{metric.total_requests_1m}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">{translations.successRate}</div>
                    <div className="font-mono">
                      {((1 - metric.error_rate) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">{translations.p95Latency}</div>
                    <div className="font-mono">{metric.latency_p95_ms.toFixed(0)}ms</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">{translations.p99Latency}</div>
                    <div className="font-mono">{metric.latency_p99_ms.toFixed(0)}ms</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};