import { FileQuestion } from "lucide-react";
import { StatusScreen } from "@/components/ui/StatusScreen";

export default function NotFound() {
  return (
    <StatusScreen
      icon={FileQuestion}
      title="This page does not exist"
      message="The link may be mistyped, or what it pointed to was removed."
      action={{ href: "/", label: "Go to the home page" }}
      reason="404"
    />
  );
}
