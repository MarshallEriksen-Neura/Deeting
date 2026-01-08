"use client";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Network, Edit } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n-context";

type RoutingStatus = "Active" | "Inactive";

type RoutingRule = {
    id: number;
    name: string;
    strategy: string;
    models: string[];
    weight: string;
    status: RoutingStatus;
};

interface RoutingTableProps {
    routingRules: RoutingRule[];
    onEdit: (id: number) => void;
}

export function RoutingTable({ routingRules, onEdit }: RoutingTableProps) {
    const { t } = useI18n();

    const getStatusLabel = (status: RoutingStatus) =>
        status === "Active"
            ? t("routing.rules_status_active")
            : t("routing.rules_status_inactive");

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("routing.rules_table_title")}</CardTitle>
                <CardDescription>
                    {t("routing.rules_table_description")}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("routing.rules_table_name")}</TableHead>
                            <TableHead>{t("routing.rules_table_strategy")}</TableHead>
                            <TableHead>{t("routing.rules_table_models")}</TableHead>
                            <TableHead>{t("routing.rules_table_weight")}</TableHead>
                            <TableHead>{t("routing.rules_table_status")}</TableHead>
                            <TableHead className="text-right">
                                {t("routing.rules_table_actions")}
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {routingRules.map((rule) => (
                            <TableRow key={rule.id}>
                                <TableCell className="font-medium">
                                    <div className="flex items-center">
                                        <Network className="w-4 h-4 mr-2 text-muted-foreground" />
                                        {rule.name}
                                    </div>
                                </TableCell>
                                <TableCell>{rule.strategy}</TableCell>
                                <TableCell className="text-sm">
                                    {rule.models.join(" → ")}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{rule.weight}</TableCell>
                                <TableCell>
                                    <span
                                        className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                                            rule.status === "Active"
                                                ? "bg-green-100 text-green-700"
                                                : "bg-gray-100 text-gray-700"
                                        }`}
                                    >
                                        {getStatusLabel(rule.status)}
                                    </span>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => onEdit(rule.id)}
                                            >
                                                <Edit className="w-4 h-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t("routing.rules_action_edit")}
                                        </TooltipContent>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
