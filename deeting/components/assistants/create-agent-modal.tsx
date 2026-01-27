"use client"

import * as React from "react"
import { useForm, type UseFormReturn } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Plus, Loader2, Sparkles, Trash2, Check, ChevronDown, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { createAssistant, updateAssistant, deleteAssistant as deleteCloudAssistant } from "@/lib/api"
import { useAssistantTags } from "@/lib/swr/use-assistant-tags"
import { cn } from "@/lib/utils"
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

type Translator = ReturnType<typeof useTranslations>

type AssistantFormValues = {
  name: string
  desc: string
  systemPrompt: string
  tags: string[]
  iconId: string
  color: string
  shareToMarket?: boolean
}

interface EditableAssistant {
  id: string
  name: string
  desc: string
  systemPrompt: string
  tags: string[]
  iconId: string
  color?: string
  visibility?: string
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
    if (!nextOpen) {
      setDeleteDialogOpen(false)
    }
    onOpenChange?.(nextOpen)
  }
  const createLocalAssistant = useMarketStore((state) => state.createLocalAssistant)
  const updateLocalAssistant = useMarketStore((state) => state.updateLocalAssistant)
  const deleteLocalAssistant = useMarketStore((state) => state.deleteLocalAssistant)
  const isEditMode = Boolean(assistant)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const { tags: assistantTags } = useAssistantTags()
  const stripTagPrefix = React.useCallback((value: string) => value.replace(/^#+/, ""), [])
  const tagOptions = React.useMemo(() => {
    const names = assistantTags
      .map((tag) => tag.name)
      .filter(Boolean)
      .map((name) => stripTagPrefix(name))
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
  }, [assistantTags, stripTagPrefix])
  const optionalSuffix = t("create.optionalSuffix")

  const formSchema = React.useMemo(
    () =>
      z.object({
        name: z.string().min(2, {
          message: t("create.validation.nameMin"),
        }),
        desc: z.string().max(200),
        systemPrompt: z.string().min(20, {
          message: t("create.validation.promptMin"),
        }),
        tags: z.array(z.string()).default([]),
        iconId: z.string().min(1, {
          message: t("create.validation.iconRequired"),
        }),
        color: z.string(),
        shareToMarket: z.boolean().optional(),
      }),
    [t]
  )

  const defaultValues = React.useMemo(
    () => ({
      name: assistant?.name ?? "",
      desc: assistant?.desc ?? "",
      systemPrompt: assistant?.systemPrompt ?? "",
      tags: assistant?.tags?.map(stripTagPrefix) ?? [],
      iconId: assistant?.iconId ?? "lucide:bot",
      color: assistant?.color ?? "from-blue-500 to-cyan-500",
      shareToMarket: assistant?.visibility === "public",
    }),
    [assistant, stripTagPrefix]
  )

  const form = useForm<AssistantFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  React.useEffect(() => {
    if (currentOpen) {
      form.reset(defaultValues)
    }
  }, [currentOpen, defaultValues, form])

  async function onSubmit(values: AssistantFormValues) {
    const desc = values.desc.trim()
    const tagsArray = (() => {
      const seen = new Set<string>()
      const normalized: string[] = []
      for (const raw of values.tags || []) {
        const trimmed = stripTagPrefix(raw).trim()
        if (!trimmed) continue
        const key = trimmed.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        normalized.push(trimmed)
      }
      return normalized
    })()
    try {
      let createdId: string | undefined
      if (mode === "local") {
        if (assistant) {
          await updateLocalAssistant(assistant.id, {
            name: values.name,
            description: desc || null,
            avatar: values.iconId,
            system_prompt: values.systemPrompt,
            tags: tagsArray,
            visibility: "private",
            source: "local",
          })
        } else {
          createdId = await createLocalAssistant({
            name: values.name,
            description: desc || null,
            avatar: values.iconId,
            system_prompt: values.systemPrompt,
            tags: tagsArray,
            visibility: "private",
            source: "local",
          })
        }
      } else {
        const shareToMarket = Boolean(values.shareToMarket)
        if (assistant) {
          await updateAssistant(assistant.id, {
            visibility: shareToMarket ? "public" : "private",
            status: shareToMarket ? "published" : "draft",
            summary: desc ? desc.slice(0, 200) : null,
            icon_id: values.iconId,
            version: {
              name: values.name,
              description: desc || null,
              system_prompt: values.systemPrompt,
              tags: tagsArray,
            },
          })
        } else {
          const created = await createAssistant({
            visibility: shareToMarket ? "public" : "private",
            status: shareToMarket ? "published" : "draft",
            summary: desc ? desc.slice(0, 200) : null,
            icon_id: values.iconId,
            share_to_market: shareToMarket,
            version: {
              name: values.name,
              description: desc || null,
              system_prompt: values.systemPrompt,
              tags: tagsArray,
            },
          })
          createdId = created?.id
        }
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
      if (mode === "local") {
        await deleteLocalAssistant(assistant.id)
      } else {
        await deleteCloudAssistant(assistant.id)
      }
      toast.success(t("toast.assistantDeletedTitle"), {
        description: t("toast.assistantDeletedDesc", { name: assistant.name }),
      })
      setDeleteDialogOpen(false)
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
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl max-h-screen overflow-y-auto p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <SheetHeader className="px-6 pt-6">
          <SheetTitle>{isEditMode ? t("edit.title") : t("create.title")}</SheetTitle>
          <SheetDescription>
            {isEditMode
              ? t("edit.description")
              : mode === "cloud"
                ? t("create.descriptionCloud")
                : t("create.description")}
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

            <AssistantProfileFields
              form={form}
              t={t}
              optionalSuffix={optionalSuffix}
            />

            <AssistantTagsField
              form={form}
              options={tagOptions}
              t={t}
              optionalSuffix={optionalSuffix}
              resetKey={`${currentOpen}-${assistant?.id ?? "new"}`}
            />

            {mode === "cloud" ? (
              <AssistantShareField form={form} t={t} />
            ) : null}

            <AssistantPromptField form={form} t={t} />

            <SheetFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              {isEditMode ? (
                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setDeleteDialogOpen(true)
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("edit.delete")}
                  </Button>
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
                    {isEditMode
                      ? t("edit.submitting")
                      : mode === "cloud"
                        ? t("create.submittingCloud")
                        : t("create.submitting")}
                  </>
                ) : (
                  isEditMode
                    ? t("edit.submit")
                    : mode === "cloud"
                      ? t("create.submitCloud")
                      : t("create.submit")
                )}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

interface AssistantFieldProps {
  form: UseFormReturn<AssistantFormValues>
  t: Translator
}

interface AssistantProfileFieldsProps extends AssistantFieldProps {
  optionalSuffix: string
}

function AssistantProfileFields({ form, t, optionalSuffix }: AssistantProfileFieldsProps) {
  return (
    <>
      <FormField
        control={form.control}
        name="desc"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{`${t("create.descLabel")}${optionalSuffix}`}</FormLabel>
            <FormControl>
              <Input placeholder={t("create.descPlaceholder")} {...field} />
            </FormControl>
            <FormDescription>{t("create.descHelp")}</FormDescription>
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
            <FormDescription>{t("create.iconHelp")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

interface AssistantTagsFieldProps extends AssistantFieldProps {
  optionalSuffix: string
  options: string[]
  resetKey: string
}

function AssistantTagsField({
  form,
  t,
  options,
  optionalSuffix,
  resetKey,
}: AssistantTagsFieldProps) {
  const [tagQuery, setTagQuery] = React.useState("")

  React.useEffect(() => {
    setTagQuery("")
  }, [resetKey])

  return (
    <FormField
      control={form.control}
      name="tags"
      render={({ field }) => {
        const selectedTags = field.value || []
        const filteredTags = tagQuery.trim()
          ? options.filter((tag) =>
              tag.toLowerCase().includes(tagQuery.trim().toLowerCase())
            )
          : options

        return (
          <FormItem>
            <FormLabel>{`${t("create.tagsLabel")}${optionalSuffix}`}</FormLabel>
            <FormControl>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {selectedTags.length ? (
                    selectedTags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                        #{tag}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 p-0"
                          onClick={() => {
                            field.onChange(selectedTags.filter((item) => item !== tag))
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("create.tagsEmpty")}
                    </span>
                  )}
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between"
                    >
                      <span className="text-muted-foreground">
                        {t("create.tagsSelectPlaceholder")}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-3">
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <Input
                          placeholder={t("create.tagsInputPlaceholder")}
                          value={tagQuery}
                          onChange={(event) => setTagQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return
                            event.preventDefault()
                            const nextTag = tagQuery.trim()
                            if (!nextTag) return
                            const normalized = nextTag.toLowerCase()
                            const selected = new Set(
                              selectedTags.map((item) => item.toLowerCase())
                            )
                            if (selected.has(normalized)) {
                              setTagQuery("")
                              return
                            }
                            field.onChange([...selectedTags, nextTag])
                            setTagQuery("")
                          }}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!tagQuery.trim()}
                          onClick={() => {
                            const nextTag = tagQuery.trim()
                            if (!nextTag) return
                            const normalized = nextTag.toLowerCase()
                            const selected = new Set(
                              selectedTags.map((item) => item.toLowerCase())
                            )
                            if (selected.has(normalized)) {
                              setTagQuery("")
                              return
                            }
                            field.onChange([...selectedTags, nextTag])
                            setTagQuery("")
                          }}
                        >
                          {t("create.tagsAdd")}
                        </Button>
                      </div>
                      <ScrollArea className="h-48 pr-2">
                        <div className="space-y-1">
                          {filteredTags.map((tag) => {
                            const selected = selectedTags.some(
                              (item) => item.toLowerCase() === tag.toLowerCase()
                            )
                            return (
                              <Button
                                key={tag}
                                type="button"
                                variant="ghost"
                                className={cn(
                                  "w-full justify-between",
                                  selected && "bg-accent"
                                )}
                                onClick={() => {
                                  if (selected) {
                                    field.onChange(
                                      selectedTags.filter(
                                        (item) => item.toLowerCase() !== tag.toLowerCase()
                                      )
                                    )
                                    return
                                  }
                                  field.onChange([...selectedTags, tag])
                                }}
                              >
                                <span className="truncate">#{tag}</span>
                                {selected ? <Check className="h-4 w-4 text-primary" /> : null}
                              </Button>
                            )
                          })}
                          {filteredTags.length === 0 ? (
                            <div className="py-2 text-xs text-muted-foreground">
                              {t("create.tagsNoOptions")}
                            </div>
                          ) : null}
                        </div>
                      </ScrollArea>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </FormControl>
            <FormDescription>{t("create.tagsHelp")}</FormDescription>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}

function AssistantPromptField({ form, t }: AssistantFieldProps) {
  return (
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
          <FormDescription>{t("create.systemPromptHelp")}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function AssistantShareField({ form, t }: AssistantFieldProps) {
  return (
    <FormField
      control={form.control}
      name="shareToMarket"
      render={({ field }) => (
        <FormItem className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <FormLabel>{t("create.shareLabel")}</FormLabel>
              <FormDescription>{t("create.shareHelp")}</FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </div>
        </FormItem>
      )}
    />
  )
}
