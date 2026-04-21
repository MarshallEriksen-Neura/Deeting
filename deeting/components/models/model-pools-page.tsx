"use client";

import * as React from "react";
import useSWR from "swr";
import { Activity, Cpu, Link2, Waves, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Container } from "@/components/ui/common/container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/shadcn/card";
import { Badge } from "@/components/ui/shadcn/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/shadcn/table";
import { PageHeader } from "@/components/models/page-header";
import { fetchLocalModelPoolsStatus, type LocalModelPoolStatus } from "@/lib/api/model-pools";
import { isTauriRuntime } from "@/lib/runtime/tauri";

const QUERY_KEY = "local-model-pools-status";

function formatPercent(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";
}

function formatLatency(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? `${Math.round(value)} ms` : "--";
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function SummaryCard({ title, value, icon: Icon }: { title: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-5">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
          <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">{value}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/40 p-3">
          <Icon className="size-5 text-[var(--accent-strong)]" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ModelPoolsPage() {
  const t = useTranslations("model-pools");
  const locale = useLocale();
  const [desktopReady, setDesktopReady] = React.useState<boolean | null>(null);
  const [selectedPoolKey, setSelectedPoolKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDesktopReady(isTauriRuntime());
  }, []);

  const { data, error, isLoading } = useSWR<LocalModelPoolStatus[]>(
    desktopReady ? QUERY_KEY : null,
    fetchLocalModelPoolsStatus,
    { revalidateOnFocus: false }
  );

  const pools = data ?? [];

  React.useEffect(() => {
    if (!pools.length) {
      setSelectedPoolKey(null);
      return;
    }
    if (!selectedPoolKey || !pools.some((pool) => pool.pool_key === selectedPoolKey)) {
      setSelectedPoolKey(pools[0].pool_key);
    }
  }, [pools, selectedPoolKey]);

  const selectedPool = pools.find((pool) => pool.pool_key === selectedPoolKey) ?? pools[0] ?? null;
  const summary = React.useMemo(() => {
    const totalPools = pools.length;
    const totalSessions = pools.reduce((sum, pool) => sum + pool.active_session_count, 0);
    const coolingProviders = pools.reduce((sum, pool) => sum + pool.cooling_down_count, 0);
    const health = totalPools ? Math.round(pools.reduce((sum, pool) => sum + pool.health_score, 0) / totalPools) : 0;
    return { totalPools, totalSessions, coolingProviders, health };
  }, [pools]);

  return (
    <Container as="main" size="full" gutter="md" className="py-6">
      <PageHeader title={t("title")} description={t("subtitle")} icon={Activity} />

      {desktopReady === null || isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">{t("loading")}</CardContent>
        </Card>
      ) : !desktopReady ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("desktopOnlyTitle")}</CardTitle>
            <CardDescription>{t("desktopOnlyDescription")}</CardDescription>
          </CardHeader>
        </Card>
      ) : error ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("errorTitle")}</CardTitle>
            <CardDescription>{String(error)}</CardDescription>
          </CardHeader>
        </Card>
      ) : !pools.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("emptyTitle")}</CardTitle>
            <CardDescription>{t("emptyDescription")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard title={t("metrics.pools")} value={String(summary.totalPools)} icon={Cpu} />
            <SummaryCard title={t("metrics.sessions")} value={String(summary.totalSessions)} icon={Link2} />
            <SummaryCard title={t("metrics.cooling")} value={String(summary.coolingProviders)} icon={Waves} />
            <SummaryCard title={t("metrics.health")} value={`${summary.health}%`} icon={Zap} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>{t("sections.directory")}</CardTitle>
                <CardDescription>{t("descriptions.directory")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pools.map((pool) => {
                  const selected = pool.pool_key === selectedPool?.pool_key;
                  return (
                    <button
                      key={pool.pool_key}
                      type="button"
                      onClick={() => setSelectedPoolKey(pool.pool_key)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition ${selected ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/40"}`}
                    >
                      <div>
                        <div className="font-medium text-[var(--ink)]">{pool.display_name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{pool.provider_count} providers</div>
                      </div>
                      <Badge variant={selected ? "default" : "secondary"}>{pool.health_score}</Badge>
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            {selectedPool ? (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>{selectedPool.display_name}</CardTitle>
                    <CardDescription>{t("descriptions.focus")}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t("labels.poolKey")}</div>
                      <div className="mt-1 font-mono text-sm text-[var(--ink)]">{selectedPool.pool_key}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t("labels.healthScore")}</div>
                      <div className="mt-1 text-sm text-[var(--ink)]">{selectedPool.health_score}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t("labels.success")}</div>
                      <div className="mt-1 text-sm text-[var(--ink)]">{formatPercent(selectedPool.success_rate)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t("labels.latency")}</div>
                      <div className="mt-1 text-sm text-[var(--ink)]">{formatLatency(selectedPool.avg_latency_ms)}</div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t("sections.members")}</CardTitle>
                    <CardDescription>{t("descriptions.members")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("labels.memberModel")}</TableHead>
                          <TableHead>{t("labels.status")}</TableHead>
                          <TableHead>{t("labels.success")}</TableHead>
                          <TableHead>{t("labels.latency")}</TableHead>
                          <TableHead>{t("labels.pinnedSessions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedPool.members.length ? (
                          selectedPool.members.map((member) => (
                            <TableRow key={member.provider_model_id}>
                              <TableCell>
                                <div className="font-medium text-[var(--ink)]">{member.display_name || member.unified_model_id || member.model_id}</div>
                                <div className="text-xs text-muted-foreground">{member.instance_name}</div>
                              </TableCell>
                              <TableCell>{member.status}</TableCell>
                              <TableCell>{formatPercent(member.success_rate)}</TableCell>
                              <TableCell>{formatLatency(member.avg_latency_ms)}</TableCell>
                              <TableCell>{member.pinned_session_count}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                              {t("empty.members")}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t("sections.bindings")}</CardTitle>
                    <CardDescription>{t("descriptions.bindings")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("labels.boundProvider")}</TableHead>
                          <TableHead>{t("labels.lastActive")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedPool.bindings.length ? (
                          selectedPool.bindings.map((binding) => (
                            <TableRow key={`${binding.session_id}:${binding.pinned_provider_model_id}`}>
                              <TableCell>
                                <div className="font-medium text-[var(--ink)]">{binding.title || binding.session_id}</div>
                                <div className="text-xs text-muted-foreground">{binding.pinned_provider_model_id}</div>
                              </TableCell>
                              <TableCell>{formatDate(binding.last_active_at || binding.updated_at, locale)}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                              {t("empty.bindings")}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Container>
  );
}
