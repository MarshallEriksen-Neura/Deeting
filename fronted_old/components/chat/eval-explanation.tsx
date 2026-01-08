"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import type { EvalExplanation as EvalExplanationType } from "@/lib/api-types";

interface EvalExplanationProps {
  explanation: EvalExplanationType;
}

/**
 * EvalExplanation 组件
 * 显示评测解释（summary + evidence）
 * 
 * Requirements: 5.3
 */
export function EvalExplanation({ explanation }: EvalExplanationProps) {
  const { t } = useI18n();

  return (
    <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-600" />
          {t("chat.eval.explanation")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 摘要 */}
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            {t("chat.eval.explanation_summary")}
          </p>
          <p className="text-sm whitespace-pre-wrap">{explanation.summary}</p>
        </div>

        {/* 证据（可选） */}
        {explanation.evidence && Object.keys(explanation.evidence).length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("chat.eval.explanation_evidence")}
            </p>
            <div className="space-y-2">
              {/* Policy Version */}
              {explanation.evidence.policy_version && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    Policy: {explanation.evidence.policy_version}
                  </Badge>
                </div>
              )}

              {/* Exploration */}
              {explanation.evidence.exploration !== undefined && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant={explanation.evidence.exploration ? "default" : "secondary"}
                    className="text-xs gap-1"
                  >
                    {explanation.evidence.exploration && (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {explanation.evidence.exploration ? "Exploration" : "Exploitation"}
                  </Badge>
                </div>
              )}

              {/* 其他证据字段 */}
              {Object.entries(explanation.evidence)
                .filter(
                  ([key]) => key !== "policy_version" && key !== "exploration"
                )
                .map(([key, value]) => (
                  <div key={key} className="text-xs text-muted-foreground">
                    <span className="font-medium">{key}:</span>{" "}
                    <span className="font-mono">{JSON.stringify(value)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
