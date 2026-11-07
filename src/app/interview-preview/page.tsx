import { notFound } from "next/navigation";
import { InterviewPreview } from "./InterviewPreview";

/** Design preview of the candidate screens with sample data. Local development only. */
export default function InterviewPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <InterviewPreview />;
}
