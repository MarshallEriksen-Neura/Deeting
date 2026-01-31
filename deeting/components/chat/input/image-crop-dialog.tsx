"use client"

import * as React from "react"
import Cropper, { ReactCropperElement } from "react-cropper"
import "cropperjs/dist/cropper.css"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  VisuallyHidden,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  ZoomIn,
  ZoomOut,
  Square,
  RectangleHorizontal,
  Maximize,
  Check,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 裁剪结果
 */
export interface CropResult {
  /** 裁剪后的 Blob 对象 */
  blob: Blob
  /** 裁剪后的 base64 字符串 */
  base64: string
  /** 裁剪后的宽度 */
  width: number
  /** 裁剪后的高度 */
  height: number
}

/**
 * 预设裁剪比例
 */
export type AspectRatioPreset = "free" | "1:1" | "16:9" | "4:3" | "3:2"

const ASPECT_RATIO_MAP: Record<AspectRatioPreset, number | undefined> = {
  free: undefined,
  "1:1": 1,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "3:2": 3 / 2,
}

const ASPECT_RATIO_ICONS: Record<AspectRatioPreset, React.ReactNode> = {
  free: <Maximize className="h-4 w-4" />,
  "1:1": <Square className="h-4 w-4" />,
  "16:9": <RectangleHorizontal className="h-4 w-4" />,
  "4:3": <RectangleHorizontal className="h-4 w-4" />,
  "3:2": <RectangleHorizontal className="h-4 w-4" />,
}

/**
 * ImageCropDialog 组件属性
 */
export interface ImageCropDialogProps {
  /** 弹窗打开状态 */
  open: boolean
  /** 弹窗状态变更回调 */
  onOpenChange: (open: boolean) => void
  /** 待裁剪的图片源（URL 或 base64） */
  imageSrc: string
  /** 初始裁剪比例，默认自由裁剪 */
  aspectRatio?: number
  /** 输出图片 MIME 类型，默认 image/png */
  outputType?: string
  /** JPEG/WebP 输出质量 0-1，默认 0.92 */
  outputQuality?: number
  /** 弹窗标题 */
  title?: string
  /** 是否显示比例切换工具栏，默认 true */
  showAspectRatioToolbar?: boolean
  /** 裁剪完成回调 */
  onCropComplete: (result: CropResult) => void
}

/**
 * 图片裁剪弹窗组件
 *
 * 基于 react-cropper 封装的纯裁剪弹窗，支持：
 * - 可配置裁剪比例（自由、1:1、16:9、4:3、3:2）
 * - 旋转、翻转、缩放操作
 * - 同时输出 Blob 和 base64 格式
 *
 * @example
 * ```tsx
 * <ImageCropDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   imageSrc={imageUrl}
 *   aspectRatio={1}
 *   onCropComplete={(result) => {
 *     console.log(result.blob, result.base64)
 *   }}
 * />
 * ```
 */
export function ImageCropDialog({
  open,
  onOpenChange,
  imageSrc,
  aspectRatio,
  outputType = "image/png",
  outputQuality = 0.92,
  title = "裁剪图片",
  showAspectRatioToolbar = true,
  onCropComplete,
}: ImageCropDialogProps) {
  const cropperRef = React.useRef<ReactCropperElement>(null)
  const [currentAspectRatio, setCurrentAspectRatio] = React.useState<
    number | undefined
  >(aspectRatio)
  const [isProcessing, setIsProcessing] = React.useState(false)

  // 当 aspectRatio prop 变化时同步内部状态
  React.useEffect(() => {
    setCurrentAspectRatio(aspectRatio)
  }, [aspectRatio])

  // 获取当前选中的预设比例 key
  const getCurrentPreset = React.useCallback((): AspectRatioPreset => {
    if (currentAspectRatio === undefined) return "free"
    for (const [key, value] of Object.entries(ASPECT_RATIO_MAP)) {
      if (value === currentAspectRatio) return key as AspectRatioPreset
    }
    return "free"
  }, [currentAspectRatio])

  // 切换裁剪比例
  const handleAspectRatioChange = React.useCallback(
    (preset: AspectRatioPreset) => {
      const ratio = ASPECT_RATIO_MAP[preset]
      setCurrentAspectRatio(ratio)
      const cropper = cropperRef.current?.cropper
      if (cropper) {
        cropper.setAspectRatio(ratio ?? NaN)
      }
    },
    []
  )

  // 旋转
  const handleRotate = React.useCallback((degree: number) => {
    cropperRef.current?.cropper?.rotate(degree)
  }, [])

  // 翻转
  const handleFlip = React.useCallback((direction: "horizontal" | "vertical") => {
    const cropper = cropperRef.current?.cropper
    if (!cropper) return
    const data = cropper.getData()
    if (direction === "horizontal") {
      cropper.scaleX(data.scaleX === -1 ? 1 : -1)
    } else {
      cropper.scaleY(data.scaleY === -1 ? 1 : -1)
    }
  }, [])

  // 缩放
  const handleZoom = React.useCallback((ratio: number) => {
    cropperRef.current?.cropper?.zoom(ratio)
  }, [])

  // 确认裁剪
  const handleConfirm = React.useCallback(async () => {
    const cropper = cropperRef.current?.cropper
    if (!cropper) return

    setIsProcessing(true)
    try {
      const canvas = cropper.getCroppedCanvas()
      if (!canvas) {
        setIsProcessing(false)
        return
      }

      const width = canvas.width
      const height = canvas.height
      const base64 = canvas.toDataURL(outputType, outputQuality)

      // 转换为 Blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b)
            else reject(new Error("Failed to create blob"))
          },
          outputType,
          outputQuality
        )
      })

      onCropComplete({ blob, base64, width, height })
      onOpenChange(false)
    } catch (error) {
      console.error("Crop failed:", error)
    } finally {
      setIsProcessing(false)
    }
  }, [outputType, outputQuality, onCropComplete, onOpenChange])

  // 取消
  const handleCancel = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle>{title}</DialogTitle>
          <VisuallyHidden>
            <p>图片裁剪工具，支持旋转、翻转、缩放和比例调整</p>
          </VisuallyHidden>
        </DialogHeader>

        {/* Cropper 区域 */}
        <div className="relative bg-muted/50">
          <Cropper
            ref={cropperRef}
            src={imageSrc}
            style={{ height: 400, width: "100%" }}
            aspectRatio={currentAspectRatio ?? NaN}
            viewMode={1}
            minCropBoxHeight={50}
            minCropBoxWidth={50}
            background={false}
            responsive
            autoCropArea={0.8}
            checkOrientation={false}
            guides
          />
        </div>

        {/* 工具栏 */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t bg-background">
          {/* 左侧：操作按钮 */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleRotate(-90)}
              title="逆时针旋转"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleRotate(90)}
              title="顺时针旋转"
            >
              <RotateCw className="h-4 w-4" />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleFlip("horizontal")}
              title="水平翻转"
            >
              <FlipHorizontal className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleFlip("vertical")}
              title="垂直翻转"
            >
              <FlipVertical className="h-4 w-4" />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleZoom(0.1)}
              title="放大"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleZoom(-0.1)}
              title="缩小"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </div>

          {/* 中间：比例选择 */}
          {showAspectRatioToolbar && (
            <div className="flex items-center gap-1">
              {(Object.keys(ASPECT_RATIO_MAP) as AspectRatioPreset[]).map(
                (preset) => (
                  <Button
                    key={preset}
                    variant={getCurrentPreset() === preset ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => handleAspectRatioChange(preset)}
                    className={cn(
                      "gap-1 px-2",
                      getCurrentPreset() === preset && "bg-secondary"
                    )}
                    title={preset === "free" ? "自由裁剪" : `${preset} 比例`}
                  >
                    {ASPECT_RATIO_ICONS[preset]}
                    <span className="text-xs">{preset === "free" ? "自由" : preset}</span>
                  </Button>
                )
              )}
            </div>
          )}
        </div>

        {/* 底部：确认/取消 */}
        <DialogFooter className="px-4 py-3 border-t">
          <Button variant="outline" onClick={handleCancel} disabled={isProcessing}>
            <X className="h-4 w-4 mr-1" />
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={isProcessing}>
            {isProcessing ? (
              <span className="animate-spin mr-1">⏳</span>
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            确认裁剪
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
