"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { CheckCircle, XCircle, RefreshCw, PauseCircle, Shield, Power, Loader2 } from "lucide-react";

interface AuditOperationsProps {
  auditRemark: string;
  setAuditRemark: (value: string) => void;
  rejectReason: string;
  setRejectReason: (value: string) => void;
  limitQps: string;
  setLimitQps: (value: string) => void;
  auditSubmitting: boolean;
  onTest: () => void;
  onApprove: (limited: boolean) => void;
  onReject: () => void;
  onPause: () => void;
  onResume: () => void;
  onOffline: () => void;
  translations: {
    title: string;
    description: string;
    remarkPlaceholder: string;
    limitQps: string;
    limitQpsHint: string;
    reject: string;
    rejectPlaceholder: string;
    rejectReasonHint: string;
    auditOperations: string;
    testNow: string;
    testing: string;
    approve: string;
    approveLimited: string;
    operationOperations: string;
    pause: string;
    resume: string;
    offline: string;
  };
}

export const AuditOperations = ({
  auditRemark,
  setAuditRemark,
  rejectReason,
  setRejectReason,
  limitQps,
  setLimitQps,
  auditSubmitting,
  onTest,
  onApprove,
  onReject,
  onPause,
  onResume,
  onOffline,
  translations,
}: AuditOperationsProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translations.title}</CardTitle>
        <CardDescription>{translations.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 操作表单 */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="audit-remark">{translations.remarkPlaceholder}</Label>
              <Textarea
                id="audit-remark"
                value={auditRemark}
                onChange={(e) => setAuditRemark(e.target.value)}
                placeholder={translations.remarkPlaceholder}
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="limit-qps">{translations.limitQps}</Label>
              <Input
                id="limit-qps"
                type="number"
                min={1}
                value={limitQps}
                onChange={(e) => setLimitQps(e.target.value)}
                placeholder="例如: 2"
              />
              <p className="text-xs text-muted-foreground">
                {translations.limitQpsHint}
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reject-reason">{translations.reject}</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={translations.rejectPlaceholder}
                rows={5}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {translations.rejectReasonHint}
              </p>
            </div>
          </div>
        </div>

        {/* 审核操作按钮组 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">{translations.auditOperations}</h4>
            <div className="flex-1 border-t" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Button 
              size="sm" 
              onClick={onTest} 
              disabled={auditSubmitting}
              variant="outline"
              className="w-full"
            >
              {auditSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {translations.testing}
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {translations.testNow}
                </>
              )}
            </Button>
            <Button 
              size="sm" 
              onClick={() => onApprove(false)} 
              disabled={auditSubmitting}
              className="w-full"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {translations.approve}
            </Button>
            <Button 
              size="sm" 
              variant="secondary" 
              onClick={() => onApprove(true)} 
              disabled={auditSubmitting}
              className="w-full"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {translations.approveLimited}
            </Button>
            <Button 
              size="sm" 
              variant="destructive" 
              onClick={onReject} 
              disabled={auditSubmitting}
              className="w-full"
            >
              <XCircle className="h-4 w-4 mr-2" />
              {translations.reject}
            </Button>
          </div>

          {/* 运营操作按钮组 */}
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">{translations.operationOperations}</h4>
            <div className="flex-1 border-t" />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={onPause} 
              disabled={auditSubmitting}
              className="w-full"
            >
              <PauseCircle className="h-4 w-4 mr-2" />
              {translations.pause}
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={onResume} 
              disabled={auditSubmitting}
              className="w-full"
            >
              <Shield className="h-4 w-4 mr-2" />
              {translations.resume}
            </Button>
            <Button 
              size="sm" 
              variant="destructive" 
              onClick={onOffline} 
              disabled={auditSubmitting}
              className="w-full"
            >
              <Power className="h-4 w-4 mr-2" />
              {translations.offline}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};