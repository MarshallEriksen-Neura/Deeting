import { redirect } from "@/i18n/routing";

export default function RootPage() {
  redirect({ href: "/", locale: "zh-CN" });
}
