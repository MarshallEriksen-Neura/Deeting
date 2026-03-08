"use client"

import { useTranslations } from "next-intl"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RechargeHistory } from "./recharge-history"
import { TransactionStream } from "./transaction-stream"

export function CreditsAuditTabs() {
  const t = useTranslations("credits")

  return (
    <Tabs defaultValue="spending" className="w-full gap-4">
      <TabsList className="grid w-full max-w-md grid-cols-2 bg-[var(--muted)]/10 border border-[var(--muted)]/10 p-1 h-auto">
        <TabsTrigger value="spending" className="py-2">
          {t("auditTabs.spending")}
        </TabsTrigger>
        <TabsTrigger value="recharge" className="py-2">
          {t("auditTabs.recharge")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="spending" className="m-0">
        <TransactionStream />
      </TabsContent>

      <TabsContent value="recharge" className="m-0">
        <RechargeHistory />
      </TabsContent>
    </Tabs>
  )
}

