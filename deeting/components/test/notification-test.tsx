"use client"

import { useNotifications } from "@/components/contexts/notification-context"
import { useNotificationActions } from "@/stores/notification-store"
import { Button } from "@/components/ui/button"

export function NotificationTestButtons() {
  const { setProcessing } = useNotifications()
  const { addNotification } = useNotificationActions()

  const testSuccessNotification = () => {
    addNotification({
      type: "success",
      title: "模型接入成功",
      description: "系统已自动为你切换到最新的 DeepSeek V3 模型，点击测试对话。",
      timestamp: new Date(),
      action: {
        label: "测试对话",
        onClick: () => console.log("Navigate to chat")
      }
    })
  }

  const testWarningNotification = () => {
    addNotification({
      type: "warning",
      title: "余额不足预警",
      description: "你的 Token 余额已低于 5% ($2.00)。建议及时充值以避免服务中断。",
      timestamp: new Date(),
      action: {
        label: "去充值",
        onClick: () => console.log("Navigate to recharge")
      }
    })
  }

  const testErrorNotification = () => {
    addNotification({
      type: "error",
      title: "连接断开",
      description: "无法连接到 OpenAI 接口",
      timestamp: new Date()
    })
  }

  const testAmbientLight = () => {
    setProcessing(true, "正在生成图片...")
    setTimeout(() => {
      setProcessing(false)
    }, 3000)
  }

  return (
    <div className="p-4 space-y-2">
      <h3 className="text-lg font-semibold mb-4">通知系统测试</h3>
      
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={testSuccessNotification} variant="outline">
          成功通知
        </Button>
        
        <Button onClick={testWarningNotification} variant="outline">
          警告通知
        </Button>
        
        <Button onClick={testErrorNotification} variant="outline">
          错误通知
        </Button>
        
        <Button onClick={testAmbientLight} variant="outline">
          环境光测试
        </Button>
      </div>
    </div>
  )
}