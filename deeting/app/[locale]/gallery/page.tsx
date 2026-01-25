import { getTranslations } from "next-intl/server"
import { GalleryPageClient } from "./gallery-page-client"

export default async function GalleryPage() {
  const t = await getTranslations("common.gallery")
  const tCommon = await getTranslations("common")

  return (
    <GalleryPageClient
      title={
        <>
          {t("title")}{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-blue-600">
             Highlight
          </span>
        </>
      }
      description={<p>{t("description")}</p>}
      searchPlaceholder={tCommon("headerNav.images") + "..."}
    />
  )
}
