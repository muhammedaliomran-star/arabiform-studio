import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { decodeForm } from "@/lib/form-storage";
import { Filler } from "@/components/istinsakh/filler";
import type { FormDoc } from "@/lib/form-types";

export const Route = createFileRoute("/share")({
  component: SharePage,
  head: () => ({
    meta: [
      { title: "نموذج مشارَك — استنساخ" },
      {
        name: "description",
        content: "افتح نموذجًا عربيًا تمت مشاركته معك عبر رابط، واملأه مباشرة داخل متصفحك بدون تسجيل دخول.",
      },
      { property: "og:title", content: "نموذج مشارَك — استنساخ" },
      {
        property: "og:description",
        content: "املأ نموذجًا عربيًا تمت مشاركته معك عبر رابط، مباشرة في المتصفح.",
      },
    ],
  }),
});

function SharePage() {
  const [form, setForm] = useState<FormDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.hash.slice(1)).get("d");
    if (!code) {
      setError("الرابط لا يحتوي على بيانات نموذج.");
      return;
    }
    try {
      setForm(decodeForm(code));
    } catch {
      setError("تعذّر قراءة النموذج من الرابط.");
    }
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-surface/80 px-4 py-4 backdrop-blur md:px-8">
        <a href="/" className="text-sm font-extrabold tracking-tight">
          استنساخ
        </a>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
        <h1 className="sr-only">نموذج مشارَك</h1>
        {error && (
          <p role="alert" className="surface-card p-6 text-sm text-destructive">
            {error}
          </p>
        )}
        {done && (
          <div className="surface-card grid place-items-center p-16 text-center">
            <p className="text-xl font-extrabold">تم إرسال إجابتك</p>
            <p className="mt-2 text-sm text-muted-foreground">
              حُفظت الإجابة في متصفحك فقط، لا يوجد خادم يجمع البيانات.
            </p>
          </div>
        )}
        {form && !done && <Filler form={form} onSubmit={() => setDone(true)} />}
      </main>
    </div>
  );
}
