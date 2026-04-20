import * as React from "react"

import { cn } from "@/lib/utils"

type ContainerSize = "default" | "wide" | "full"
type ContainerGutter = "sm" | "md" | "lg"

const sizeClassMap: Record<ContainerSize, string> = {
  default: "max-w-[1440px]",
  wide: "max-w-[1600px]",
  full: "max-w-none",
}

const gutterClassMap: Record<ContainerGutter, string> = {
  sm: "px-4",
  md: "px-6",
  lg: "px-8",
}

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 预设宽度：默认 1440px，wide 为 1600px，full 取消最大宽度限制
   */
  size?: ContainerSize
  /**
   * 左右内边距：sm=16px, md=24px, lg=32px
   */
  gutter?: ContainerGutter
  /**
   * 可选标签，默认为 div，可传 main/section 等
   */
  as?: React.ElementType
}

export function Container({
  size = "default",
  gutter = "md",
  as: Component = "div",
  className,
  ...props
}: ContainerProps) {
  return (
    <Component
      className={cn(
        "mx-auto w-full",
        sizeClassMap[size],
        gutterClassMap[gutter],
        className
      )}
      {...props}
    />
  )
}

export default Container
