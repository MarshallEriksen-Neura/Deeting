"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface ProbeValidationCardProps {
  validationResults: any[];
  validationLoading: boolean;
  onValidate: () => void;
  onOpenProbeDrawer: () => void;
  translations: {
    title: string;
    description: string;
    probeTitle: string;
    probeDesc: string;
    probeSave: string;
    validateModels: string;
    validateHint: string;
    validating: string;
    validateSuccessShort: string;
    validateFailed: string;
    validateEmpty: string;
  };
}

export const ProbeValidationCard = ({
  validationResults,
  validationLoading,
  onValidate,
  onOpenProbeDrawer,
  translations,
}: ProbeValidationCardProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translations.title}</CardTitle>
        <CardDescription>{translations.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 探针配置 */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm font-medium">{translations.probeTitle}</Label>
              <p className="text-xs text-muted-foreground">
                {translations.probeDesc}
              </p>
            </div>
            <Button size="sm" onClick={onOpenProbeDrawer}>
              {translations.probeSave}
            </Button>
          </div>
        </div>

        {/* 模型验证 */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm font-medium">{translations.validateModels}</Label>
              <p className="text-xs text-muted-foreground">
                {translations.validateHint}
              </p>
            </div>
            <Button size="sm" onClick={onValidate} disabled={validationLoading}>
              {validationLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {translations.validating}
                </>
              ) : (
                translations.validateModels
              )}
            </Button>
          </div>
          {validationResults.length > 0 ? (
            <div className="rounded border divide-y">
              {validationResults.map((res: any) => (
                <div key={res.model_id} className="p-3 text-sm flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-medium">{res.model_id}</span>
                    <span className="text-xs text-muted-foreground">
                      {res.error_message || "-"}
                    </span>
                  </div>
                  <Badge variant={res.success ? "default" : "destructive"}>
                    {res.success ? translations.validateSuccessShort : translations.validateFailed}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              {translations.validateEmpty}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};