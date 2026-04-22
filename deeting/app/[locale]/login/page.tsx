import { Suspense } from "react";
import { LoginPageClient } from "@/components/auth";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageClient />
    </Suspense>
  );
}
