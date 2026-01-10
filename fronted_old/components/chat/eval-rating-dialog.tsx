"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import type { ChallengerRun, ReasonTag } from "@/lib/api-types";

interface EvalRatingDialogProps {
  /**
   * 对话框是否打开
   */
  open: boolean;
  /**
   * 关闭对话框的回调
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Baseline run
   */
  baselineRun: {
    run_id: string;
    requested_logical_model: string;
    output_preview?: string;
  };
  /**
   * Challenger runs
   */
  challengers: ChallengerRun[];
  /**
   * 提交评分的回调
   */
  onSubmit: (winnerRunId: string, reasonTags: ReasonTag[]) => Promise<void>;
  /**
   * 是否正在提交
   */
  isSubmitting?: boolean;
}

/**
 * EvalRatingDialog 组件
 * 实现赢家选择和原因标签多选
 * 使用 Dialog 组件
 * 
 * Requirements: 6.1, 6.2
 */
export function EvalRatingDialog({
  open,
  onOpenChange,
  baselineRun,
  challengers,
  onSubmit,
  isSubmitting = false,
}: EvalRatingDialogProps) {
  const { t } = useI18n();

  // 选中的赢家 run_id
  const [selectedWinner, setSelectedWinner] = useState<string | null>(null);
  // 选中的原因标签
  const [selectedReasons, setSelectedReasons] = useState<Set<ReasonTag>>(new Set());

  // 所有可选的 runs（baseline + challengers）
  const allRuns = [
    {
      run_id: baselineRun.run_id,
      requested_logical_model: baselineRun.requested_logical_model,
      output_preview: baselineRun.output_preview,
      isBaseline: true,
    },
    ...challengers
      .filter((c) => c.status === "succeeded")
      .map((c) => ({
        run_id: c.run_id,
        requested_logical_model: c.requested_logical_model,
        output_preview: c.output_preview,
        isBaseline: false,
      })),
  ];

  // 所有可选的原因标签
  const reasonTags: ReasonTag[] = [
    "accurate",
    "complete",
    "concise",
    "safe",
    "fast",
    "cheap",
  ];

  // 切换原因标签选择
  const toggleReason = (reason: ReasonTag) => {
    const newReasons = new Set(selectedReasons);
    if (newReasons.has(reason)) {
      newReasons.delete(reason);
    } else {
      newReasons.add(reason);
    }
    setSelectedReasons(newReasons);
  };

  // 提交评分
  const handleSubmit = async () => {
    if (!selectedWinner || selectedReasons.size === 0) {
      return;
    }

    await onSubmit(selectedWinner, Array.from(selectedReasons));

    // 重置状态
    setSelectedWinner(null);
    setSelectedReasons(new Set());
  };

  // 关闭对话框时重置状态
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedWinner(null);
      setSelectedReasons(new Set());
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        aria-describedby="eval-rating-description"
      >
        <DialogHeader>
          <DialogTitle>{t("chat.eval.select_winner")}</DialogTitle>
          <DialogDescription id="eval-rating-description">
            {t("chat.eval.rating_instructions")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 选择赢家 */}
          <div className="space-y-3">
            <Label className="text-base font-medium" id="winner-selection-label">
              {t("chat.eval.select_winner")}
            </Label>
            <div 
              className="space-y-2" 
              role="radiogroup" 
              aria-labelledby="winner-selection-label"
              aria-required="true"
            >
              {allRuns.map((run) => (
                <Card
                  key={run.run_id}
                  className={`cursor-pointer transition-all ${
                    selectedWinner === run.run_id
                      ? "border-primary border-2"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => setSelectedWinner(run.run_id)}
                  role="radio"
                  aria-checked={selectedWinner === run.run_id}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedWinner(run.run_id);
                    }
                  }}
                  aria-label={`${run.requested_logical_model}${run.isBaseline ? ` (${t("chat.eval.baseline")})` : ""}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {run.requested_logical_model}
                          </p>
                          {run.isBaseline && (
                            <Badge variant="secondary">
                              {t("chat.eval.baseline")}
                            </Badge>
                          )}
                        </div>
                        {run.output_preview && (
                          <p className="text-sm text-muted-foreground line-clamp-3">
                            {run.output_preview}
                          </p>
                        )}
                      </div>
                      {selectedWinner === run.run_id && (
                        <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" aria-hidden="true" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* 选择原因标签 */}
          <div className="space-y-3">
            <Label className="text-base font-medium" id="reason-tags-label">
              {t("chat.eval.reason_tags")}
            </Label>
            <div 
              className="grid grid-cols-2 gap-3" 
              role="group" 
              aria-labelledby="reason-tags-label"
              aria-required="true"
            >
              {reasonTags.map((reason) => (
                <div
                  key={reason}
                  className="flex items-center space-x-2 cursor-pointer"
                  onClick={() => toggleReason(reason)}
                >
                  <Checkbox
                    id={`reason-${reason}`}
                    checked={selectedReasons.has(reason)}
                    onCheckedChange={() => toggleReason(reason)}
                    aria-label={t(`chat.eval.reason_${reason}`)}
                  />
                  <Label
                    htmlFor={`reason-${reason}`}
                    className="cursor-pointer"
                  >
                    {t(`chat.eval.reason_${reason}`)}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
            aria-label={t("chat.action.cancel")}
          >
            {t("chat.action.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !selectedWinner || selectedReasons.size === 0 || isSubmitting
            }
            aria-label={isSubmitting ? t("chat.eval.submitting") : t("chat.eval.submit")}
            autoFocus
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSubmitting ? t("chat.eval.submitting") : t("chat.eval.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
