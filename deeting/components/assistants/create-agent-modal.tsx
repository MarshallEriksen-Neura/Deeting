"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Plus, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import { ProviderIconPicker } from "@/components/providers/provider-icon-picker"

const formSchema = z.object({
  name: z.string().min(2, {
    message: "Name must be at least 2 characters.",
  }),
  desc: z.string().min(10, {
    message: "Description must be at least 10 characters.",
  }),
  systemPrompt: z.string().min(20, {
    message: "System prompt must be meaningful (at least 20 characters).",
  }),
  tags: z.string().min(2, {
     message: "Add at least one tag."
  }),
  iconId: z.string().min(1, {
    message: "Select an icon.",
  }),
  color: z.string(),
})

const COLOR_OPTIONS = [
  { label: "Ocean Blue", value: "from-blue-500 to-cyan-500" },
  { label: "Sunset Pink", value: "from-pink-500 to-rose-500" },
  { label: "Emerald Green", value: "from-emerald-500 to-teal-500" },
  { label: "Mystic Purple", value: "from-violet-500 to-purple-500" },
  { label: "Amber Orange", value: "from-orange-400 to-amber-500" },
  { label: "Neon Fuchsia", value: "from-fuchsia-500 to-pink-500" },
]

interface CreateAgentModalProps {
  onCreated?: () => void
}

export function CreateAgentModal({ onCreated }: CreateAgentModalProps) {
  const [open, setOpen] = React.useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      desc: "",
      systemPrompt: "",
      tags: "",
      iconId: "lucide:bot",
      color: "from-blue-500 to-cyan-500",
    },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    const tagsArray = values.tags.split(/[,，\s]+/).filter(Boolean)
    try {
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

      toast.success("Assistant Created", {
        description: `${values.name} 已创建，可在“我的助手”中管理。`,
        icon: <Sparkles className="w-4 h-4 text-yellow-400" />,
      })
      setOpen(false)
      form.reset()
      onCreated?.()
    } catch (error) {
      toast.error("创建失败", {
        description: "请稍后重试或检查输入内容",
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg border-0">
          <Plus className="mr-2 h-4 w-4" /> Create Assistant
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Persona</DialogTitle>
          <DialogDescription>
            Design a custom AI assistant. It will be installed locally and submitted to the market.
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
            
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Python Guru" {...field} />
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
                  <FormLabel>Short Description</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Expert in Python optimization and debugging..." {...field} />
                  </FormControl>
                  <FormDescription>
                    Displayed on the agent card in the marketplace.
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
                  <FormLabel>Theme</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a theme color" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {COLOR_OPTIONS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full bg-gradient-to-r ${color.value}`} />
                            {color.label}
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
                  <FormLabel>Icon</FormLabel>
                  <FormControl>
                    <ProviderIconPicker value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>
                    Choose an icon to represent your assistant.
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
                  <FormLabel>Tags</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Coding, Python, Debugging" {...field} />
                  </FormControl>
                  <FormDescription>
                    Comma separated keywords.
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
                  <FormLabel>System Prompt (Personality)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="You are an expert Python developer with a sarcastic tone..." 
                      className="min-h-[150px] font-mono text-sm"
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    This defines how your assistant behaves and answers.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting} className="w-full sm:w-auto">
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create & Install"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
