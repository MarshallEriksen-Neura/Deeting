"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import type { ProviderTestResult } from "@/http/provider";

interface AuditHistoryCardProps {
  recentTests: ProviderTestResult[];
  auditLogs: any[];
  translations: {
    title: string;
    description: string;
    recentTests: string;
    auditLogs: string;
    lastRunAt: string;
    latestLatency: string;
  };
}

export const AuditHistoryCard = ({
  recentTests,
  auditLogs,
  translations,
}: AuditHistoryCardProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translations.title}</CardTitle>
        <CardDescription>{translations.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {recentTests.length > 0 && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">{translations.recentTests}</Label>
            <div className="rounded border divide-y">
              {recentTests.map((test) => (
                <div key={test.id} className="p-3 text-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={test.success ? "default" : "destructive"}>
                      {test.mode}
                    </Badge>
                    <span className="text-muted-foreground">{test.summary || "-"}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3">
                    {test.latency_ms != null && (
                      <span>{translations.latestLatency}: {test.latency_ms} ms</span>
                    )}
                    <span>{test.finished_at || test.created_at}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {auditLogs.length > 0 && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">{translations.auditLogs}</Label>
            <div className="rounded border divide-y">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-3 text-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{log.action}</Badge>
                    {log.remark && <span className="text-muted-foreground">{log.remark}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {log.created_at}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};