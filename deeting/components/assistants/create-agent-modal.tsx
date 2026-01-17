"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Plus, Loader2, Sparkles, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createAssistant } from "@/lib/api"
import { useMarketStore } from "@/store/market-store"
import { ProviderIconPicker } from "@/components/providers/provider-icon-picker"

const COLOR_OPTIONS = [
  { key: "ocean", value: "from-blue-500 to-cyan-500" },
  { key: "sunset", value: "from-pink-500 to-rose-500" },
  { key: "emerald", value: "from-emerald-500 to-teal-500" },
  { key: "mystic", value: "from-violet-500 to-purple-500" },
  { key: "amber", value: "from-orange-400 to-amber-500" },
  { key: "neon", value: "from-fuchsia-500 to-pink-500" },
]

interface EditableAssistant {
  id: string
  name: string
  desc: string
  systemPrompt: string
  tags: string[]
  iconId: string
  color?: string
}

interface CreateAgentModalProps {
  mode?: "local" | "cloud"
  trigger?: React.ReactNode
  assistant?: EditableAssistant
  onCreated?: (assistantId?: string) => void
  onUpdated?: (assistantId: string) => void
  onDeleted?: (assistantId: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateAgentModal({
  mode = "local",
  trigger,
  assistant,
  onCreated,
  onUpdated,
  onDeleted,
  open,
  onOpenChange,
}: CreateAgentModalProps) {
  const t = useTranslations("assistants")
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = open !== undefined
  const currentOpen = isControlled ? open : internalOpen
  const handleOpenChange = (nextOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }
  const createLocalAssistant = useMarketStore((state) => state.createLocalAssistant)
  const updateLocalAssistant = useMarketStore((state) => state.updateLocalAssistant)
  const deleteLocalAssistant = useMarketStore((state) => state.deleteLocalAssistant)
  const isEditMode = Boolean(assistant)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const formSchema = React.useMemo(
    () =>
      z.object({
        name: z.string().min(2, {
          message: t("create.validation.nameMin"),
        }),
        desc: z.string().min(10, {
          message: t("create.validation.descMin"),
        }),
        systemPrompt: z.string().min(20, {
          message: t("create.validation.promptMin"),
        }),
        tags: z.string().min(2, {
          message: t("create.validation.tagsMin"),
        }),
        iconId: z.string().min(1, {
          message: t("create.validation.iconRequired"),
        }),
        color: z.string(),
      }),
    [t]
  )

  const defaultValues = React.useMemo(
    () => ({
      name: assistant?.name ?? "",
      desc: assistant?.desc ?? "",
      systemPrompt: assistant?.systemPrompt ?? "",
      tags: assistant?.tags?.join(", ") ?? "",
      iconId: assistant?.iconId ?? "lucide:bot",
      color: assistant?.color ?? "from-blue-500 to-cyan-500",
    }),
    [assistant]
  )

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  React.useEffect(() => {
    if (currentOpen) {
      form.reset(defaultValues)
    }
  }, [currentOpen, defaultValues, form])

  async function onSubmit(values: z.infer<typeof formSchema>) {
    const tagsArray = values.tags.split(/[,，\s]+/).filter(Boolean)
    try {
      let createdId: string | undefined
      if (mode === "local") {
        if (assistant) {
          await updateLocalAssistant(assistant.id, {
            name: values.name,
            description: values.desc,
            avatar: values.iconId,
            system_prompt: values.systemPrompt,
            tags: tagsArray,
            visibility: "private",
            source: "local",
          })
        } else {
          createdId = await createLocalAssistant({
            name: values.name,
            description: values.desc,
            avatar: values.iconId,
            system_prompt: values.systemPrompt,
            tags: tagsArray,
            visibility: "private",
            source: "local",
          })
        }
      } else {
        await createAssistant({
          visibility: "private",
          status: "draft",
          summary: values.desc.slice(0, 200),
          icon_id: values.iconId,
          version: {
            name: values.name,
            description: values.desc,
            system_prompt: values.systemPrompt,
            tags: tagsArray,
          },
        })
      }

      if (assistant) {
        toast.success(t("toast.assistantUpdatedTitle"), {
          description: t("toast.assistantUpdatedDesc", { name: values.name }),
          icon: <Sparkles className="w-4 h-4 text-yellow-400" />,
        })
      } else {
        toast.success(t("toast.assistantCreatedTitle"), {
          description: t("toast.assistantCreatedDesc", { name: values.name }),
          icon: <Sparkles className="w-4 h-4 text-yellow-400" />,
        })
      }
      handleOpenChange(false)
      form.reset()
      if (assistant) {
        onUpdated?.(assistant.id)
      } else {
        onCreated?.(createdId)
      }
    } catch (error) {
      toast.error(t("toast.createFailedTitle"), {
        description: t("toast.createFailedDesc"),
      })
    }
  }

  async function handleDelete() {
    if (!assistant) return
    try {
      setIsDeleting(true)
      await deleteLocalAssistant(assistant.id)
      toast.success(t("toast.assistantDeletedTitle"), {
        description: t("toast.assistantDeletedDesc", { name: assistant.name }),
      })
      handleOpenChange(false)
      onDeleted?.(assistant.id)
    } catch (error) {
      toast.error(t("toast.deleteFailedTitle"), {
        description: t("toast.deleteFailedDesc"),
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const triggerNode =
    trigger !== undefined ? trigger : (
      <Button className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg border-0">
        <Plus className="mr-2 h-4 w-4" /> {t("create.trigger")}
      </Button>
    )

  return (
    <Sheet open={currentOpen} onOpenChange={handleOpenChange}>
      {triggerNode ? <SheetTrigger asChild>{triggerNode}</SheetTrigger> : null}
      <SheetContent side="right" className="w-full sm:max-w-xl max-h-screen overflow-y-auto p-0">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle>{isEditMode ? t("edit.title") : t("create.title")}</SheetTitle>
          <SheetDescription>
            {isEditMode ? t("edit.description") : t("create.description")}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 px-6 py-4">
            
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("create.nameLabel")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("create.namePlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="desc"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("create.descLabel")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("create.descPlaceholder")} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("create.descHelp")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("create.themeLabel")}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("create.themePlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {COLOR_OPTIONS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full bg-gradient-to-r ${color.value}`} />
                            {t(`create.colors.${color.key}`)}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="iconId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("create.iconLabel")}</FormLabel>
                  <FormControl>
                    <ProviderIconPicker value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>
                    {t("create.iconHelp")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("create.tagsLabel")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("create.tagsPlaceholder")} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("create.tagsHelp")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="systemPrompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("create.systemPromptLabel")}</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder={t("create.systemPromptPlaceholder")} 
                      className="min-h-[150px] font-mono text-sm"
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    {t("create.systemPromptHelp")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SheetFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              {isEditMode ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" className="w-full sm:w-auto">
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("edit.delete")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("edit.deleteConfirmTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("edit.deleteConfirmDesc", { name: assistant?.name })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("edit.deleteConfirmCancel")}</AlertDialogCancel>
                      <AlertDialogAction asChild>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={handleDelete}
                          disabled={isDeleting}
                        >
                          {isDeleting ? t("edit.deleting") : t("edit.deleteConfirmAction")}
                        </Button>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <div />
              )}
              <Button type="submit" disabled={form.formState.isSubmitting} className="w-full sm:w-auto">
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {isEditMode ? t("edit.submitting") : t("create.submitting")}
                  </>
                ) : (
                  isEditMode ? t("edit.submit") : t("create.submit")
                )}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
