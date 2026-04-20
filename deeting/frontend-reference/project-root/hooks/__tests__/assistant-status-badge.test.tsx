import { render, screen } from "@testing-library/react"
import { AgentCard } from "@/components/assistants/agent-card"

it("shows status badge for owned assistant", () => {
  render(
    <AgentCard
      agent={{
        id: "a1",
        name: "A",
        description: "",
        tags: [],
        installCount: 0,
        ratingAvg: 0,
        installed: true,
        color: "from-blue-500 to-cyan-500",
        isOwned: true,
        visibility: "public",
        status: "published",
      }}
    />
  )
  expect(screen.getByText(/published/i)).toBeInTheDocument()
})
