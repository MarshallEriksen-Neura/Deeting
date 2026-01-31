import { render, screen } from "@testing-library/react"
import AssistantsPage from "@/app/[locale]/assistants/page"

it("renders create assistant action", () => {
  render(<AssistantsPage />)
  expect(screen.getByText(/create/i)).toBeInTheDocument()
})
