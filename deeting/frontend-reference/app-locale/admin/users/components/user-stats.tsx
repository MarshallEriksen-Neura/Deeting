"use client"

import { useTranslations } from "next-intl"
import { Users, Shield, UserX, Crown } from "lucide-react"
import { AdminStatCards, type StatCardData } from "@/components/admin"

interface UserStatsProps {
  users: Array<{
    is_active: boolean
    is_superuser: boolean
  }>
}

export function UserStats({ users }: UserStatsProps) {
  const t = useTranslations("admin.usersPage.stats")
  const totalUsers = users.length
  const activeUsers = users.filter((user) => user.is_active).length
  const inactiveUsers = totalUsers - activeUsers
  const superUsers = users.filter((user) => user.is_superuser).length

  const stats: StatCardData[] = [
    { label: t("totalUsers"), value: totalUsers, icon: Users, color: "primary" },
    { label: t("active"), value: activeUsers, icon: Shield, color: "emerald" },
    { label: t("inactive"), value: inactiveUsers, icon: UserX, color: "rose" },
    { label: t("superusers"), value: superUsers, icon: Crown, color: "amber" },
  ]

  return <AdminStatCards stats={stats} columns={4} />
}

export default UserStats
