import { useEffect, useState } from 'react';
import type { ProviderLimits } from '@/lib/api-types';
import { useProviderLimits } from '@/lib/swr';
import { toast } from 'sonner';

/**
 * 管理 Provider 限制表单状态的自定义 Hook
 */
export function useProviderLimitsForm(t: (key: string) => string) {
  const { limits, loading, saving, error, saveLimits, refresh } = useProviderLimits();
  const [form, setForm] = useState<ProviderLimits | null>(null);

  // 同步后端配置到表单
  useEffect(() => {
    if (limits) {
      setForm(limits);
    }
  }, [limits]);

  const handleChange =
    (field: keyof ProviderLimits) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value =
        field === 'require_approval_for_shared_providers'
          ? (event.target as HTMLInputElement).checked
          : event.target.value;

      setForm((prev) => {
        if (!prev) return prev;
        if (field === 'require_approval_for_shared_providers') {
          return { ...prev, [field]: Boolean(value) };
        }
        const parsed = value === '' ? 0 : Number(value);
        if (Number.isNaN(parsed)) {
          return prev;
        }
        return { ...prev, [field]: parsed };
      });
    };

  const handleSwitchChange = (checked: boolean) => {
    setForm((prev) =>
      prev ? { ...prev, require_approval_for_shared_providers: checked } : prev
    );
  };

  const handleReset = () => {
    if (limits) {
      setForm(limits);
    }
  };

  const handleSave = async () => {
    if (!form) return;
    try {
      const updated = await saveLimits(form);
      setForm(updated);
      await refresh();
      toast.success(t('system.provider_limits.save_success'));
    } catch (e: any) {
      const message =
        e?.response?.data?.detail ||
        e?.message ||
        t('system.provider_limits.save_error');
      toast.error(message);
    }
  };

  const disabled = loading || saving || !form;

  return {
    form,
    loading,
    saving,
    error,
    disabled,
    handleChange,
    handleSwitchChange,
    handleReset,
    handleSave,
  };
}
