"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-context";

export function ConversationItemDialogs({
  showRenameDialog,
  setShowRenameDialog,
  draftTitle,
  setDraftTitle,
  onRenameConfirm,
  showArchiveDialog,
  setShowArchiveDialog,
  onArchiveConfirm,
}: {
  showRenameDialog: boolean;
  setShowRenameDialog: (open: boolean) => void;
  draftTitle: string;
  setDraftTitle: (value: string) => void;
  onRenameConfirm: () => void;
  showArchiveDialog: boolean;
  setShowArchiveDialog: (open: boolean) => void;
  onArchiveConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {/* 改名对话框 */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent aria-describedby="rename-conversation-dialog-description">
          <DialogHeader>
            <DialogTitle>{t("chat.conversation.rename")}</DialogTitle>
            <DialogDescription id="rename-conversation-dialog-description">
              {t("chat.conversation.rename_description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder={t("chat.conversation.rename_placeholder")}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenameDialog(false)}>
              {t("chat.action.cancel")}
            </Button>
            <Button onClick={onRenameConfirm}>{t("chat.action.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 归档确认对话框 */}
      <Dialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <DialogContent aria-describedby="archive-conversation-dialog-description">
          <DialogHeader>
            <DialogTitle>{t("chat.conversation.archive")}</DialogTitle>
            <DialogDescription id="archive-conversation-dialog-description">
              {t("chat.conversation.archive_confirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchiveDialog(false)}>
              {t("chat.action.cancel")}
            </Button>
            <Button onClick={onArchiveConfirm} autoFocus>
              {t("chat.action.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

