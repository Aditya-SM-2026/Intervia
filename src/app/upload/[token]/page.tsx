import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/BrandMark";
import { ResumeUploadForm } from "@/components/recruiter/ResumeUploadForm";

export const metadata: Metadata = { title: "Upload your resume" };

export default async function UploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 py-8">
      <BrandMark href={null} />
      <div className="flex w-full max-w-md flex-1 flex-col justify-center py-10">
        <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">Upload your resume</h1>
          <p className="mb-5 mt-1 text-sm text-muted">Your interview uses it to ask about your own work.</p>
          <ResumeUploadForm token={token} />
        </div>
      </div>
    </main>
  );
}