"use client";

import { AuditStatusCard } from "./audit-status-card";
import { AuditOperations } from "./audit-operations";
import { ProbeValidationCard } from "./probe-validation-card";
import { AuditHistoryCard } from "./audit-history-card";
import type {
  ProviderAuditStatus,
  ProviderOperationStatus,
  ProviderTestResult,
} from "@/http/provider";

interface AuditTabContentProps {
  auditStatus?: ProviderAuditStatus;
  operationStatus?: ProviderOperationStatus;
  latestTest: ProviderTestResult | null | undefined;
  auditRemark: string;
  setAuditRemark: (value: string) => void;
  rejectReason: string;
  setRejectReason: (value: string) => void;
  limitQps: string;
  setLimitQps: (value: string) => void;
  auditSubmitting: boolean;
  onTest: () => Promise<void>;
  onApprove: (limited: boolean) => Promise<void>;
  onReject: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onOffline: () => Promise<void>;
  validationResults: any[];
  validationLoading: boolean;
  onValidate: () => Promise<void>;
  onOpenProbeDrawer: () => void;
  recentTests: ProviderTestResult[];
  auditLogs: any[];
  historyTabVisible: boolean;
  translations: any;
}

/**
 * 审计 Tab 内容组件
 * 
 * 职责：
 * - 渲染审计相关的所有卡片
 * - 管理审计操作的状态
 * 
 * 优化：
 * - 从主组件中拆分出来，减少主组件复杂度
 * - 独立的组件便于维护和测试
 */
export function AuditTabContent({
  auditStatus,
  operationStatus,
  latestTest,
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
  validationResults,
  validationLoading,
  onValidate,
  onOpenProbeDrawer,
  recentTests,
  auditLogs,
  historyTabVisible,
  translations,
}: AuditTabContentProps) {
  return (
    <div className="space-y-6">
      {/* 状态概览卡片 */}
      <AuditStatusCard
        auditStatus={auditStatus}
        operationStatus={operationStatus}
        latestTest={latestTest}
        translations={translations.audit}
      />

      {/* 审核操作卡片 */}
      <AuditOperations
        auditRemark={auditRemark}
        setAuditRemark={setAuditRemark}
        rejectReason={rejectReason}
        setRejectReason={setRejectReason}
        limitQps={limitQps}
        setLimitQps={setLimitQps}
        auditSubmitting={auditSubmitting}
        onTest={onTest}
        onApprove={onApprove}
        onReject={onReject}
        onPause={onPause}
        onResume={onResume}
        onOffline={onOffline}
        translations={{
          title: translations.audit.auditOperations,
          description: translations.audit.auditOperationsDesc,
          remarkPlaceholder: translations.audit.remarkPlaceholder,
          limitQps: translations.audit.limitQps,
          limitQpsHint: translations.audit.limitQpsHint,
          reject: translations.audit.reject,
          rejectPlaceholder: translations.audit.rejectPlaceholder,
          rejectReasonHint: translations.audit.rejectReasonHint,
          auditOperations: translations.audit.auditOperations,
          testNow: translations.audit.testNow,
          testing: translations.audit.testing,
          approve: translations.audit.approve,
          approveLimited: translations.audit.approveLimited,
          operationOperations: translations.audit.operationOperations,
          pause: translations.audit.pause,
          resume: translations.audit.resume,
          offline: translations.audit.offline,
        }}
      />

      {/* 探针与验证卡片 */}
      <ProbeValidationCard
        validationResults={validationResults}
        validationLoading={validationLoading}
        onValidate={onValidate}
        onOpenProbeDrawer={onOpenProbeDrawer}
        translations={{
          title: translations.audit.probeAndValidation,
          description: translations.audit.probeAndValidationDesc,
          probeTitle: translations.audit.probeTitle,
          probeDesc: translations.audit.probeDesc,
          probeSave: translations.audit.probeSave,
          validateModels: translations.audit.validateModels,
          validateHint: translations.audit.validateHint,
          validating: translations.audit.validating,
          validateSuccessShort: translations.audit.validateSuccessShort,
          validateFailed: translations.audit.validateFailed,
          validateEmpty: translations.audit.validateEmpty,
        }}
      />

      {/* 历史记录卡片 */}
      {historyTabVisible && (
        <AuditHistoryCard
          recentTests={recentTests}
          auditLogs={auditLogs}
          translations={{
            title: translations.audit.historyTitle,
            description: translations.audit.historyDesc,
            recentTests: translations.audit.recentTests,
            auditLogs: translations.audit.auditLogs,
            lastRunAt: translations.audit.lastRunAt,
            latestLatency: translations.audit.latestLatency,
          }}
        />
      )}
    </div>
  );
}
