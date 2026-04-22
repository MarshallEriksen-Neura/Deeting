import { ErrorDiagnostic } from "@/components/common/error-diagnostic";

export default function NotFound() {
  return (
    <ErrorDiagnostic 
      code="404"
      type="404"
    />
  );
}
