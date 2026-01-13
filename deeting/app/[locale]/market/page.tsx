import { setRequestLocale } from "next-intl/server"
import { useTranslations } from "next-intl"
import { Metadata } from "next"
import { Globe } from "lucide-react"

import { Container } from "@/components/ui/container"
import { PublicMarketClient } from "./client"

export const metadata: Metadata = {
  title: 'AI Model Marketplace - Connect OpenAI, Claude, Ollama',
  description: 'Explore 100+ supported AI models. Connect local LLMs like Llama 3 or cloud APIs like GPT-4 in one unified gateway.',
  openGraph: {
    title: 'AI Model Marketplace | Deeting',
    description: 'Connect local LLMs and cloud APIs in one unified gateway.',
  },
}

// ISR: Revalidate this page every hour
export const revalidate = 3600

export default async function PublicMarketPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // Server-side fetch for SEO
  let initialData = null
  try {
     const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000'
     const res = await fetch(`${baseUrl}/api/v1/providers/hub?include_public=true`, {
        next: { revalidate: 3600 }
     })
     if (res.ok) {
        initialData = await res.json()
     }
  } catch (e) {
     console.error("Failed to fetch market data server-side:", e)
  }

  return <PublicMarketPageContent initialData={initialData} />
}

function PublicMarketPageContent({ initialData }: { initialData: any }) {
  const t = useTranslations("providers.market")

  return (
    <Container as="main" className="py-12 md:py-16" gutter="md">
      <div className="max-w-4xl mx-auto text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-600">
            {t("title")}
          </h1>
          <p className="text-xl text-[var(--muted)]">
            {t("description")}
          </p>
      </div>
      
      <PublicMarketClient initialData={initialData} />
    </Container>
  )
}
