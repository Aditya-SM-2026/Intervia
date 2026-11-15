import type { Metadata } from "next";
import { ResumeUploadForm } from "@/components/recruiter/ResumeUploadForm";

export const metadata: Metadata = { title: "Upload your resume" };

export default async function UploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ResumeUploadForm token={token} />;
}
