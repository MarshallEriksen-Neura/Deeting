"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/i18n-context';
import { useGlobalEmbeddingModelForm } from '@/lib/hooks/use-global-embedding-model-form';
import { BrainCircuit } from 'lucide-react';

export function GlobalEmbeddingModelCard() {
  const { t } = useI18n();
  const {
    value,
    setValue,
    saving,
    error,
    disabled,
    isSuperUser,
    currentSourceLabel,
    handleReset,
    handleSave,
    embeddingModels,
    modelsLoading,
  } = useGlobalEmbeddingModelForm(t);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg font-normal">
            {t('system.embedding.title')}
          </CardTitle>
        </div>
        <CardDescription>
          {t('system.embedding.subtitle')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="text-sm text-red-500">{t('system.embedding.load_error')}</p>
        )}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t('system.embedding.label')}
          </label>
          <Select
            value={value}
            onValueChange={setValue}
            disabled={disabled || modelsLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('system.embedding.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {embeddingModels.map((model) => (
                <SelectItem key={model.logical_id} value={model.logical_id}>
                  {model.display_name || model.logical_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t('system.embedding.hint')}
          </p>
          {!!currentSourceLabel && (
            <p className="text-xs text-muted-foreground">
              {t('system.embedding.current_source', { source: currentSourceLabel })}
            </p>
          )}
          {!isSuperUser && (
            <p className="text-xs text-muted-foreground">
              {t('common.error_superuser_required')}
            </p>
          )}
        </div>
        <div className="flex justify-end space-x-2 pt-2">
          <Button variant="outline" onClick={handleReset} disabled={disabled}>
            {t('system.config.reset')}
          </Button>
          <Button onClick={handleSave} disabled={disabled}>
            {saving ? t('system.config.saving') : t('system.config.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

