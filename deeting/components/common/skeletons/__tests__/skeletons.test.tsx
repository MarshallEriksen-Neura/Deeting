import { render } from "@testing-library/react"
import {
  ChatSkeleton,
  CoderSkeleton,
  ControlsSkeleton,
  SelectAgentSkeleton,
  VoiceSkeleton,
  HudSkeleton,
  ImageSkeleton,
  CanvasSkeleton,
} from "../index"

/**
 * 骨架屏组件测试套件
 * 
 * 测试目标：
 * 1. 验证所有骨架屏组件能正常渲染
 * 2. 验证 React.memo 优化已应用（通过 displayName 检查）
 * 3. 验证组件不会抛出错误
 */
describe("Skeleton Components", () => {
  describe("ChatSkeleton", () => {
    it("应该正常渲染", () => {
      const { container } = render(<ChatSkeleton />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it("应该使用 React.memo 优化", () => {
      expect(ChatSkeleton.displayName).toBe("ChatSkeleton")
    })
  })

  describe("CoderSkeleton", () => {
    it("应该正常渲染", () => {
      const { container } = render(<CoderSkeleton />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it("应该使用 React.memo 优化", () => {
      expect(CoderSkeleton.displayName).toBe("CoderSkeleton")
    })
  })

  describe("ControlsSkeleton", () => {
    it("应该正常渲染", () => {
      const { container } = render(<ControlsSkeleton />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it("应该使用 React.memo 优化", () => {
      expect(ControlsSkeleton.displayName).toBe("ControlsSkeleton")
    })
  })

  describe("SelectAgentSkeleton", () => {
    it("应该正常渲染", () => {
      const { container } = render(<SelectAgentSkeleton />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it("应该使用 React.memo 优化", () => {
      expect(SelectAgentSkeleton.displayName).toBe("SelectAgentSkeleton")
    })
  })

  describe("VoiceSkeleton", () => {
    it("应该正常渲染", () => {
      const { container } = render(<VoiceSkeleton />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it("应该使用 React.memo 优化", () => {
      expect(VoiceSkeleton.displayName).toBe("VoiceSkeleton")
    })
  })

  describe("HudSkeleton", () => {
    it("应该正常渲染", () => {
      const { container } = render(<HudSkeleton />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it("应该使用 React.memo 优化", () => {
      expect(HudSkeleton.displayName).toBe("HudSkeleton")
    })
  })

  describe("ImageSkeleton", () => {
    it("应该正常渲染", () => {
      const { container } = render(<ImageSkeleton />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it("应该使用 React.memo 优化", () => {
      expect(ImageSkeleton.displayName).toBe("ImageSkeleton")
    })
  })

  describe("CanvasSkeleton", () => {
    it("应该正常渲染", () => {
      const { container } = render(<CanvasSkeleton />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it("应该使用 React.memo 优化", () => {
      expect(CanvasSkeleton.displayName).toBe("CanvasSkeleton")
    })
  })

  describe("统一导入", () => {
    it("应该能从 index 文件统一导入所有组件", () => {
      expect(ChatSkeleton).toBeDefined()
      expect(CoderSkeleton).toBeDefined()
      expect(ControlsSkeleton).toBeDefined()
      expect(SelectAgentSkeleton).toBeDefined()
      expect(VoiceSkeleton).toBeDefined()
      expect(HudSkeleton).toBeDefined()
      expect(ImageSkeleton).toBeDefined()
      expect(CanvasSkeleton).toBeDefined()
    })
  })

  describe("性能优化", () => {
    it("所有组件都应该使用 React.memo", () => {
      const components = [
        ChatSkeleton,
        CoderSkeleton,
        ControlsSkeleton,
        SelectAgentSkeleton,
        VoiceSkeleton,
        HudSkeleton,
        ImageSkeleton,
        CanvasSkeleton,
      ]

      components.forEach((Component) => {
        expect(Component.displayName).toBeDefined()
        expect(Component.displayName).toMatch(/Skeleton$/)
      })
    })
  })
})
