import type { Metadata } from "next";
import { ResumeUploadForm } from "@/components/recruiter/ResumeUploadForm";

export const metadata: Metadata = { title: "Upload your resume — Intervia" };

export default async function UploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <h1 className="mb-5 text-xl font-semibold">Upload your resume</h1>
        <ResumeUploadForm token={token} />
      </div>
    </main>
  );
}