"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";
import type { ProviderTestResult, ProviderAuditStatus, ProviderOperationStatus } from "@/http/provider";
import { AuditStatusBadge, OperationStatusBadge } from "../status-badges";

interface AuditStatusCardProps {
  auditStatus?: ProviderAuditStatus;
  operationStatus?: ProviderOperationStatus;
  latestTest?: ProviderTestResult | null;
  translations: {
    title: string;
    auditStatus: string;
    latestTest: string;
    latestTestNone: string;
    latestSuccess: string;
    latestFailed: string;
    lastRunAt: string;
    latestLatency: string;
    latestError: string;
    status: {
      pending: string;
      testing: string;
      approved: string;
      approved_limited: string;
      rejected: string;
      unknown: string;
      active: string;
      paused: string;
      offline: string;
    };
  };
}

export const AuditStatusCard = ({
  auditStatus,
  operationStatus,
  latestTest,
  translations,
}: AuditStatusCardProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            {translations.title}
          </div>
          <div className="flex items-center gap-2">
            <AuditStatusBadge status={auditStatus} translations={translations.status} />
            <OperationStatusBadge status={operationStatus} translations={translations.status} />
          </div>
        </CardTitle>
        <CardDescription>{translations.auditStatus}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* 最新测试结果 */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">{translations.latestTest}</Label>
          {latestTest ? (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <Badge variant={latestTest.success ? "default" : "destructive"}>
                  {latestTest.success
                    ? translations.latestSuccess
                    : translations.latestFailed}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {translations.lastRunAt}: {latestTest.finished_at || latestTest.created_at}
                </span>
              </div>
              {latestTest.summary && (
                <p className="text-sm text-muted-foreground mb-2">{latestTest.summary}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {latestTest.latency_ms != null && (
                  <span>{translations.latestLatency}: {latestTest.latency_ms} ms</span>
                )}
                {latestTest.error_code && (
                  <span>{translations.latestError}: {latestTest.error_code}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/30 p-4 text-center">
              <p className="text-sm text-muted-foreground">{translations.latestTestNone}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};