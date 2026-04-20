import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[calc(var(--radius)+999px)] border border-transparent text-sm font-medium transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive active:translate-y-px focus-visible:ring-2 focus-visible:ring-[color:var(--ios-ring)] focus-visible:ring-offset-0",
  {
    variants: {
      variant: {
        default:
          "border-[color:var(--ios-tint-border)] bg-[image:var(--ios-tint-fill)] text-[color:var(--ios-tint-foreground)] shadow-[var(--ios-button-shadow)] hover:brightness-[1.03]",
        destructive:
          "border-destructive/20 bg-destructive text-white shadow-[0_14px_28px_-18px_color-mix(in_srgb,var(--destructive)_55%,transparent)] hover:bg-destructive/92 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] text-foreground shadow-[var(--ios-button-shadow-soft)] hover:bg-[color:var(--ios-shell-hover)]",
        secondary:
          "border-[color:var(--ios-pill-border)] bg-[color:var(--ios-pill-muted)] text-[color:var(--ios-pill-foreground)] shadow-[var(--ios-button-shadow-soft)] hover:bg-[color:var(--ios-pill-hover)]",
        ghost:
          "border-transparent bg-transparent text-[color:var(--ios-pill-foreground)] hover:bg-[color:var(--ios-pill-ghost-hover)] hover:text-foreground dark:hover:bg-white/10",
        ios:
          "border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] text-[color:var(--ios-pill-foreground)] shadow-[var(--ios-button-shadow-soft)] backdrop-blur-xl hover:bg-[color:var(--ios-shell-hover)]",
        "ios-primary":
          "border-[color:var(--ios-tint-border)] bg-[image:var(--ios-tint-fill)] text-[color:var(--ios-tint-foreground)] shadow-[var(--ios-button-shadow)] hover:brightness-[1.04]",
        "ios-segment":
          "border-transparent bg-transparent text-[color:var(--ios-segment-foreground)] shadow-none hover:bg-[color:var(--ios-segment-hover)]",
        "ios-segment-active":
          "border-[color:var(--ios-segment-active-border)] bg-[color:var(--ios-segment-active-bg)] text-[color:var(--ios-segment-active-foreground)] shadow-[var(--ios-segment-shadow)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-7 px-2.5 text-xs has-[>svg]:px-2",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        xl: "h-11 px-6 text-[15px] has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef<
  React.ElementRef<"button">,
  React.ComponentPropsWithoutRef<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean
    }
>(({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
