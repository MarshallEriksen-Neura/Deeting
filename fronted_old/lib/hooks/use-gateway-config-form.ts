import { useEffect, useState } from 'react';
import type { GatewayConfig } from '@/lib/api-types';
import { useGatewayConfig } from '@/lib/swr';
import { toast } from 'sonner';

/**
 * 管理网关配置表单状态的自定义 Hook
 */
export function useGatewayConfigForm(t: (key: string) => string) {
  const { config, loading, saving, error, saveConfig, refresh } = useGatewayConfig();
  const [form, setForm] = useState<GatewayConfig | null>(null);

  // 同步后端配置到表单
  useEffect(() => {
    if (config) {
      setForm(config);
    }
  }, [config]);

  const handleChange =
    (field: keyof GatewayConfig) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;

      setForm((prev) => {
        if (!prev) {
          return prev;
        }

        if (
          field === 'max_concurrent_requests' ||
          field === 'request_timeout_ms' ||
          field === 'cache_ttl_seconds'
        ) {
          const parsed = value === '' ? 0 : Number(value);
          return {
            ...prev,
            [field]: Number.isNaN(parsed) ? prev[field] : parsed,
          };
        }

        return {
          ...prev,
          [field]: value,
        };
      });
    };

  const handleReset = () => {
    if (config) {
      setForm(config);
    }
  };

  const handleSave = async () => {
    if (!form) return;
    try {
      const updated = await saveConfig(form);
      setForm(updated);
      await refresh();
      toast.success(t('system.config.save_success'));
    } catch (e: any) {
      const message =
        e?.response?.data?.detail || e?.message || t('system.config.save_error');
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
    handleReset,
    handleSave,
  };
}
