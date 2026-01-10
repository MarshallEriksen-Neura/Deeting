"use client";

import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertCircle, XCircle, Loader2, Activity, PauseCircle, Power } from "lucide-react";
import type { ProviderStatus, ProviderAuditStatus, ProviderOperationStatus } from "@/http/provider";

interface StatusBadgeProps {
  status: ProviderStatus | undefined;
  translations: {
    healthy: string;
    degraded: string;
    down: string;
    unknown: string;
  };
}

export const StatusBadge = ({ status, translations }: StatusBadgeProps) => {
  if (!status) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <AlertCircle className="w-3.5 h-3.5" />
        {translations.unknown}
      </Badge>
    );
  }

  const statusConfig = {
    healthy: {
      icon: CheckCircle,
      label: translations.healthy,
      variant: "default" as const,
      className: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800",
    },
    degraded: {
      icon: AlertCircle,
      label: translations.degraded,
      variant: "outline" as const,
      className: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800",
    },
    down: {
      icon: XCircle,
      label: translations.down,
      variant: "destructive" as const,
      className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800",
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={`gap-1.5 ${config.className}`}>
      <Icon className="w-3.5 h-3.5" />
      {config.label}
    </Badge>
  );
};

interface AuditStatusBadgeProps {
  status?: ProviderAuditStatus;
  translations: {
    pending: string;
    testing: string;
    approved: string;
    approved_limited: string;
    rejected: string;
    unknown: string;
  };
}

export const AuditStatusBadge = ({ status, translations }: AuditStatusBadgeProps) => {
  const map: Record<ProviderAuditStatus, { label: string; variant: "outline" | "default" | "destructive"; icon: React.ElementType; className?: string }> = {
    pending: { label: translations.pending, variant: "outline", icon: AlertCircle },
    testing: { label: translations.testing, variant: "outline", icon: Loader2, className: "animate-spin" },
    approved: { label: translations.approved, variant: "default", icon: CheckCircle },
    approved_limited: { label: translations.approved_limited, variant: "default", icon: CheckCircle },
    rejected: { label: translations.rejected, variant: "destructive", icon: XCircle },
  };

  if (!status || !map[status]) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <AlertCircle className="w-3.5 h-3.5" />
        {translations.unknown}
      </Badge>
    );
  }

  const cfg = map[status];
  const Icon = cfg.icon;

  return (
    <Badge variant={cfg.variant} className="gap-1.5">
      <Icon className={`w-3.5 h-3.5 ${cfg.className ?? ""}`} />
      {cfg.label}
    </Badge>
  );
};

interface OperationStatusBadgeProps {
  status?: ProviderOperationStatus;
  translations: {
    active: string;
    paused: string;
    offline: string;
    unknown: string;
  };
}

export const OperationStatusBadge = ({ status, translations }: OperationStatusBadgeProps) => {
  if (!status) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <AlertCircle className="w-3.5 h-3.5" />
        {translations.unknown}
      </Badge>
    );
  }

  const map: Record<ProviderOperationStatus, { label: string; variant: "outline" | "default" | "destructive"; icon: React.ElementType }> = {
    active: { label: translations.active, variant: "default", icon: Activity },
    paused: { label: translations.paused, variant: "outline", icon: PauseCircle },
    offline: { label: translations.offline, variant: "destructive", icon: Power },
  };

  const cfg = map[status];
  const Icon = cfg.icon;

  return (
    <Badge variant={cfg.variant} className="gap-1.5">
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </Badge>
  );
};