"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-context";
import { toast } from "sonner";
import { useCreateRegistrationWindow } from "@/lib/swr/use-registration-windows";

interface RegistrationWindowDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: "auto" | "manual" | null;
    startTimeLocal: string;
    endTimeLocal: string;
    maxRegistrations: string;
    onStartTimeChange: (value: string) => void;
    onEndTimeChange: (value: string) => void;
    onMaxRegistrationsChange: (value: string) => void;
    onSuccess: () => void;
}

export function RegistrationWindowDialog({
    open,
    onOpenChange,
    mode,
    startTimeLocal,
    endTimeLocal,
    maxRegistrations,
    onStartTimeChange,
    onEndTimeChange,
    onMaxRegistrationsChange,
    onSuccess,
}: RegistrationWindowDialogProps) {
    const { t } = useI18n();
    const { createAuto, createManual, creating: creatingWindow } = useCreateRegistrationWindow();

    const handleCreate = async () => {
        if (!startTimeLocal || !endTimeLocal || !maxRegistrations) {
            toast.error(t("users.registration.validation_required"));
            return;
        }

        const startDate = new Date(startTimeLocal);
        const endDate = new Date(endTimeLocal);

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            toast.error(t("users.registration.validation_required"));
            return;
        }

        if (endDate <= startDate) {
            toast.error(t("users.registration.validation_start_end"));
            return;
        }

        const max = Number(maxRegistrations);
        if (!Number.isFinite(max) || max <= 0) {
            toast.error(t("users.registration.validation_max_positive"));
            return;
        }

        const payload = {
            start_time: startDate.toISOString(),
            end_time: endDate.toISOString(),
            max_registrations: max,
        };

        try {
            if (mode === "manual") {
                await createManual(payload);
            } else {
                await createAuto(payload);
            }
            toast.success(t("users.registration.create_success"));
            onSuccess();
        } catch (error: any) {
            const message = error?.response?.data?.detail || error?.message || t("users.registration.create_error");
            toast.error(message);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {mode === "manual"
                            ? t("users.registration.create_manual")
                            : t("users.registration.create_auto")}
                    </DialogTitle>
                    <DialogDescription>{t("users.registration.subtitle")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t("users.registration.window_start")}</label>
                            <Input
                                type="datetime-local"
                                value={startTimeLocal}
                                onChange={(e) => onStartTimeChange(e.target.value)}
                                disabled={creatingWindow}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t("users.registration.window_end")}</label>
                            <Input
                                type="datetime-local"
                                value={endTimeLocal}
                                onChange={(e) => onEndTimeChange(e.target.value)}
                                disabled={creatingWindow}
                            />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm font-medium">{t("users.registration.max_registrations")}</label>
                            <Input
                                type="number"
                                min={1}
                                value={maxRegistrations}
                                onChange={(e) => onMaxRegistrationsChange(e.target.value)}
                                disabled={creatingWindow}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("users.registration.form_hint")}</p>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creatingWindow}>
                        {t("users.status_dialog_cancel")}
                    </Button>
                    <Button onClick={handleCreate} disabled={creatingWindow}>
                        {creatingWindow ? t("common.saving") : t("users.status_dialog_confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
