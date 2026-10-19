import { useRef, useState } from "react";
import { ChevronDown, Link2, FilePlus2, Upload, AlertTriangle, FileText } from "lucide-react";

import { TEMPLATES } from "@/lib/form-templates";

export function Importer({
  url,
  setUrl,
  onImport,
  onBlank,
  onImportJson,
  onImportDoc,
  onTemplate,
  loading,
  error,
  compact,
}: {
  url: string;
  setUrl: (v: string) => void;
  onImport: () => void;
  onBlank: () => void;
  onImportJson: (file: File) => void;
  onImportDoc: () => void;
  onTemplate: (key: string) => void;
  loading: boolean;
  error: string | null;
  compact: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  const fileRef = useRef<HTMLInputElement>(null);
  const expanded = open || !compact;

  const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  if (compact && !open) {
    return (
      <div className="surface-card flex flex-wrap items-center gap-3 px-4 py-3">
        <Link2 className="h-4 w-4 text-primary" aria-hidden />
        <button
          onClick={() => setOpen(true)}
          className={`text-sm font-bold ${focusRing} rounded-md`}
          aria-expanded={false}
        >
          استنساخ نموذج جديد
        </button>
        <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        <button
          onClick={onBlank}
          className={`ms-auto rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-secondary ${focusRing}`}
        >
          + نموذج فارغ
        </button>
      </div>
    );
  }

  return (
    <div className="surface-card p-5 md:p-7">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">
          استيراد
        </span>
        <h2 className="text-lg font-extrabold tracking-tight md:text-2xl">
          ألصق رابط نموذج جوجل عام
        </h2>
        {compact && (
          <button
            onClick={() => setOpen(false)}
            className={`ms-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground ${focusRing}`}
          >
            إخفاء
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        نقرأ الأسئلة والخيارات ونحوّلها إلى نموذج قابل للتعديل بالكامل داخل متصفحك — بدون تسجيل دخول
        وبدون إرسال بياناتك لأي جهة.
      </p>

      <div className="flex flex-col gap-2.5 md:flex-row">
        <label htmlFor="gform-url" className="sr-only">
          رابط نموذج جوجل
        </label>
        <input
          id="gform-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onImport()}
          placeholder="https://docs.google.com/forms/d/e/.../viewform"
          dir="ltr"
          className={`min-w-0 flex-1 rounded-xl border border-input bg-surface px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30`}
        />
        <button
          onClick={onImport}
          disabled={loading}
          className={`rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50 ${focusRing}`}
        >
          {loading ? "جارٍ الاستنساخ..." : "استنسخ الآن"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onBlank}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold transition hover:bg-secondary ${focusRing}`}
        >
          <FilePlus2 className="h-3.5 w-3.5" aria-hidden /> ابدأ من الصفر
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold transition hover:bg-secondary ${focusRing}`}
        >
          <Upload className="h-3.5 w-3.5" aria-hidden /> استيراد ملف JSON
        </button>
        <button
          onClick={onImportDoc}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold transition hover:bg-secondary ${focusRing}`}
        >
          <FileText className="h-3.5 w-3.5" aria-hidden /> استيراد من ملف أسئلة
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportJson(f);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p className="flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            تعذّر الاستنساخ
          </p>
          <p className="mt-1">{error}</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs opacity-90">
            <li>تأكد أن النموذج عام: «إرسال» ← أي شخص لديه الرابط يمكنه الرد.</li>
            <li>استخدم رابط <span dir="ltr">/viewform</span> وليس رابط التحرير <span dir="ltr">/edit</span>.</li>
            <li>النماذج المقيَّدة بمؤسسة أو التي تتطلب تسجيل دخول لا يمكن قراءتها.</li>
            <li>إن استمرت المشكلة، افتح النموذج في متصفحك وتأكد أنه يفتح بدون تسجيل دخول.</li>
          </ul>
        </div>
      )}

      {expanded && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <span className="text-xs font-semibold text-muted-foreground">جرّبها الآن:</span>
          {TEMPLATES.map((ex) => (
            <button
              key={ex.key}
              onClick={() => onTemplate(ex.key)}
              className={`rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold transition hover:border-primary/40 hover:bg-accent hover:text-accent-foreground ${focusRing}`}
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
