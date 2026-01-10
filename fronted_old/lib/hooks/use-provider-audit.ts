import { useState, useCallback } from "react";
import { providerService, ProviderTestResult } from "@/http/provider";
import { toast } from "sonner";
import { useErrorDisplay } from "@/lib/errors";

interface UseProviderAuditProps {
  providerId: string;
  refresh: () => Promise<void>;
  translations: any;
}

/**
 * 提供商审计管理 Hook
 * 
 * 职责：
 * - 管理审计相关的状态
 * - 处理审计操作（测试、审批、拒绝、运营状态变更）
 * - 管理探针配置
 * - 处理模型验证
 * 
 * 优化：
 * - 将复杂的状态逻辑从组件中提取出来
 * - 提高代码复用性和可测试性
 */
export function useProviderAudit({ providerId, refresh, translations }: UseProviderAuditProps) {
  const { showError } = useErrorDisplay();
  
  // 审计状态
  const [auditRemark, setAuditRemark] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [limitQps, setLimitQps] = useState<string>("");
  const [auditSubmitting, setAuditSubmitting] = useState(false);
  const [recentTests, setRecentTests] = useState<ProviderTestResult[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  
  // 探针配置状态
  const [probeEnabled, setProbeEnabled] = useState<boolean | null>(null);
  const [probeInterval, setProbeInterval] = useState<string>("");
  const [probeModel, setProbeModel] = useState<string>("");
  const [savingProbe, setSavingProbe] = useState(false);
  const [probeDrawerOpen, setProbeDrawerOpen] = useState(false);
  
  // 模型验证状态
  const [validationResults, setValidationResults] = useState<any[]>([]);
  const [validationLoading, setValidationLoading] = useState(false);

  // 管理员测试
  const handleAdminTest = useCallback(async () => {
    if (!providerId) return;
    setAuditSubmitting(true);
    try {
      await providerService.adminTestProvider(providerId, {
        mode: "custom",
        remark: auditRemark || undefined,
      });
      toast.success(translations.audit.testing);
      await refresh();
    } catch (error: any) {
      showError(error, translations.audit.testing);
    } finally {
      setAuditSubmitting(false);
    }
  }, [providerId, auditRemark, translations.audit.testing, refresh, showError]);

  // 保存探针配置
  const handleSaveProbeConfig = useCallback(async () => {
    if (!providerId) return;
    setSavingProbe(true);
    try {
      await providerService.updateProbeConfig(providerId, {
        probe_enabled: probeEnabled ?? undefined,
        probe_interval_seconds: probeInterval ? parseInt(probeInterval, 10) : undefined,
        probe_model: probeModel || undefined,
      });
      toast.success(translations.audit.probeSaveSuccess);
      await refresh();
      setProbeDrawerOpen(false);
    } catch (error: any) {
      showError(error, translations.audit.probeSave);
    } finally {
      setSavingProbe(false);
    }
  }, [providerId, probeEnabled, probeInterval, probeModel, translations.audit.probeSaveSuccess, translations.audit.probeSave, refresh, showError]);

  // 验证模型
  const handleValidateModels = useCallback(async () => {
    if (!providerId) return;
    setValidationLoading(true);
    try {
      const results = await providerService.validateProviderModels(providerId, { limit: 10 });
      setValidationResults(results);
      toast.success(translations.audit.validateSuccess);
    } catch (error: any) {
      showError(error, translations.audit.validateModels);
    } finally {
      setValidationLoading(false);
    }
  }, [providerId, translations.audit.validateSuccess, translations.audit.validateModels, showError]);

  // 审批
  const handleApprove = useCallback(async (limited: boolean) => {
    if (!providerId) return;
    setAuditSubmitting(true);
    try {
      await providerService.approveProvider(providerId, {
        remark: auditRemark || undefined,
        limit_qps: limitQps ? parseInt(limitQps, 10) : undefined,
        limited,
      });
      toast.success(limited ? translations.audit.approveLimited : translations.audit.approve);
      await refresh();
    } catch (error: any) {
      showError(error, limited ? translations.audit.approveLimited : translations.audit.approve);
    } finally {
      setAuditSubmitting(false);
    }
  }, [providerId, auditRemark, limitQps, translations.audit.approveLimited, translations.audit.approve, refresh, showError]);

  // 拒绝
  const handleReject = useCallback(async () => {
    if (!providerId) return;
    if (!rejectReason.trim()) {
      toast.error(translations.audit.rejectReasonRequired);
      return;
    }
    setAuditSubmitting(true);
    try {
      await providerService.rejectProvider(providerId, {
        remark: rejectReason,
      });
      toast.success(translations.audit.reject);
      await refresh();
    } catch (error: any) {
      showError(error, translations.audit.reject);
    } finally {
      setAuditSubmitting(false);
    }
  }, [providerId, rejectReason, translations.audit.rejectReasonRequired, translations.audit.reject, refresh, showError]);

  // 运营操作
  const handleOperation = useCallback(async (action: "pause" | "resume" | "offline") => {
    if (!providerId) return;
    setAuditSubmitting(true);
    try {
      await providerService.updateOperationStatus(providerId, action, {
        remark: auditRemark || undefined,
      });
      toast.success(translations.audit[action]);
      await refresh();
    } catch (error: any) {
      showError(error, translations.audit[action]);
    } finally {
      setAuditSubmitting(false);
    }
  }, [providerId, auditRemark, translations.audit, refresh, showError]);

  return {
    // 审计状态
    auditRemark,
    setAuditRemark,
    rejectReason,
    setRejectReason,
    limitQps,
    setLimitQps,
    auditSubmitting,
    recentTests,
    setRecentTests,
    auditLogs,
    setAuditLogs,
    
    // 探针配置
    probeEnabled,
    setProbeEnabled,
    probeInterval,
    setProbeInterval,
    probeModel,
    setProbeModel,
    savingProbe,
    probeDrawerOpen,
    setProbeDrawerOpen,
    
    // 模型验证
    validationResults,
    validationLoading,
    
    // 操作函数
    handleAdminTest,
    handleSaveProbeConfig,
    handleValidateModels,
    handleApprove,
    handleReject,
    handleOperation,
  };
}
