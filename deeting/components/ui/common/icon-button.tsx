"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center outline-none",
    "transition-[background-color,border-color,color,transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-standard)]",
    "active:translate-y-[1px] active:brightness-[0.96]",
    "focus-visible:shadow-[var(--focus-ring)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&>svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        ghost:
          "border border-transparent bg-transparent text-[var(--ink-3)] hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-[var(--ink)]",
        surface:
          "border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] hover:border-[var(--hairline-strong)] hover:text-[var(--ink)]",
        inset:
          "border border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-2)] hover:border-[var(--hairline-strong)] hover:text-[var(--ink)]",
        outline:
          "border border-[var(--hairline)] bg-transparent text-[var(--ink-2)] hover:border-[var(--hairline-strong)] hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] hover:text-[var(--ink)]",
        accent:
          "border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)] hover:bg-[color-mix(in_srgb,var(--accent-soft)_68%,white_16%)]",
      },
      size: {
        xs: "size-6 rounded-[8px] [&>svg]:size-[14px]",
        sm: "size-7 rounded-[8px] [&>svg]:size-4",
        md: "size-8 rounded-[10px] [&>svg]:size-[18px]",
        lg: "size-10 rounded-[12px] [&>svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
    },
  }
);

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible label. Also used as the native `title` tooltip when `tooltip` isn't provided. */
  label: string;
  /** Optional visible tooltip override. */
  tooltip?: string;
  /** Render as `Slot` for composition (e.g. wrapping a Link). */
  asChild?: boolean;
  /** Signals selected / pressed state. */
  active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      variant,
      size,
      label,
      tooltip,
      className,
      children,
      active,
      asChild = false,
      type,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type ?? "button"}
        aria-label={label}
        aria-pressed={typeof active === "boolean" ? active : undefined}
        title={tooltip ?? label}
        data-active={active || undefined}
        className={cn(
          iconButtonVariants({ variant, size }),
          active &&
            "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]",
          className
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);
IconButton.displayName = "IconButton";

export { iconButtonVariants };
