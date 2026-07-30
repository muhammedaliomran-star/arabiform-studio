import { FileSpreadsheet, FileJson } from "lucide-react";
import type { FormDoc, FormResponse } from "@/lib/form-types";
import { exportResponsesCsv, exportResponsesJson } from "@/lib/form-storage";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Responses({ form, responses }: { form: FormDoc; responses: FormResponse[] }) {
  if (responses.length === 0)
    return (
      <div className="surface-card grid place-items-center p-16 text-center">
        <p className="text-lg font-bold">لا توجد ردود بعد</p>
        <p className="mt-2 text-sm text-muted-foreground">
          افتح تبويب المعاينة واملأ النموذج لتظهر الردود هنا.
        </p>
      </div>
    );

  const btn = `inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold transition hover:bg-secondary ${focusRing}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold">
          {responses.length} <span className="text-muted-foreground">رد</span>
        </h2>
        <div className="flex gap-2">
          <button onClick={() => exportResponsesCsv(form, responses)} className={btn}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> تصدير CSV / Excel
          </button>
          <button onClick={() => exportResponsesJson(form, responses)} className={btn}>
            <FileJson className="h-4 w-4" aria-hidden /> JSON
          </button>
        </div>
      </div>

      {responses
        .slice()
        .reverse()
        .map((r, idx) => (
          <div key={r.id} className="surface-card p-5">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-bold">رد #{responses.length - idx}</span>
              <span className="tabular" dir="ltr">
                {new Date(r.submittedAt).toLocaleString("ar-EG")}
              </span>
            </div>
            <dl className="space-y-2 text-sm">
              {form.questions
                .filter((q) => q.type !== "section")
                .map((q) => {
                  const v = r.answers[q.id];
                  const isImage = typeof v === "string" && v.startsWith("data:image");
                  const display = Array.isArray(v) ? v.join("، ") : v || "—";
                  return (
                    <div
                      key={q.id}
                      className="grid gap-1 border-t border-border pt-2 md:grid-cols-[220px_1fr]"
                    >
                      <dt className="font-semibold text-muted-foreground">{q.title}</dt>
                      <dd>
                        {isImage ? (
                          <img
                            src={v as string}
                            alt={`إجابة ${q.title}`}
                            className="max-h-24 rounded-lg border border-border bg-surface"
                          />
                        ) : typeof v === "string" && v.startsWith("data:") ? (
                          <a href={v} download className="text-primary underline">
                            تنزيل الملف المرفق
                          </a>
                        ) : (
                          display
                        )}
                      </dd>
                    </div>
                  );
                })}
            </dl>
          </div>
        ))}
    </div>
  );
}
