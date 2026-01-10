"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import type { ChallengerRun } from "@/lib/api-types";

interface EvalChallengerCardProps {
  challenger: ChallengerRun;
  /**
   * 是否为赢家（用于评分后显示）
   */
  isWinner?: boolean;
}

/**
 * EvalChallengerCard 组件
 * 显示 challenger 的模型名称、状态、输出预览
 * 处理 running、succeeded、failed 状态
 * 
 * Requirements: 5.2, 5.4
 */
export function EvalChallengerCard({ challenger, isWinner }: EvalChallengerCardProps) {
  const { t } = useI18n();

  // 根据状态获取图标和样式
  const getStatusDisplay = () => {
    switch (challenger.status) {
      case 'queued':
        return {
          icon: <Clock className="h-4 w-4" />,
          badge: (
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" />
              {t("chat.run.status_queued")}
            </Badge>
          ),
          cardClassName: "border-muted",
        };
      case 'running':
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
          badge: (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("chat.run.status_running")}
            </Badge>
          ),
          cardClassName: "border-muted",
        };
      case 'succeeded':
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
          badge: (
            <Badge variant="default" className="gap-1 bg-green-600">
              <CheckCircle2 className="h-3 w-3" />
              {t("chat.run.status_succeeded")}
            </Badge>
          ),
          cardClassName: isWinner ? "border-green-600 border-2" : "border-green-200",
        };
      case 'failed':
        return {
          icon: <XCircle className="h-4 w-4 text-red-600" />,
          badge: (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              {t("chat.run.status_failed")}
            </Badge>
          ),
          cardClassName: "border-red-200",
        };
      default:
        return {
          icon: null,
          badge: null,
          cardClassName: "",
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <Card className={`transition-all ${statusDisplay.cardClassName}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            {statusDisplay.icon}
            {challenger.requested_logical_model}
          </CardTitle>
          {statusDisplay.badge}
        </div>
        {isWinner && (
          <Badge variant="default" className="w-fit mt-2 bg-amber-500">
            {t("chat.eval.winner")}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 输出预览 */}
        {challenger.output_preview && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t("chat.run.output")}</p>
            <p className="text-sm whitespace-pre-wrap break-words">
              {challenger.output_preview}
            </p>
          </div>
        )}

        {/* 延迟信息 */}
        {challenger.latency !== undefined && challenger.latency !== null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("chat.run.latency")}:</span>
            <span className="font-mono">{challenger.latency.toFixed(0)}ms</span>
          </div>
        )}

        {/* 错误信息 */}
        {challenger.status === 'failed' && challenger.error_code && (
          <div className="space-y-1">
            <p className="text-sm text-red-600 font-medium">{t("chat.run.error")}</p>
            <p className="text-sm text-red-600 font-mono">{challenger.error_code}</p>
          </div>
        )}

        {/* 运行中占位 */}
        {(challenger.status === 'queued' || challenger.status === 'running') && !challenger.output_preview && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("chat.eval.status_running")}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
