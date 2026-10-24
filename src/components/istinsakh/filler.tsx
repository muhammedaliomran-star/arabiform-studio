import { useMemo, useState } from "react";
import type { Answer, FormDoc, Question } from "@/lib/form-types";
import { isAnswerable, paginate } from "@/lib/form-types";
import { FieldInput } from "./field-input";
import { DriveImage } from "./drive-image";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Filler({
  form,
  onSubmit,
}: {
  form: FormDoc;
  onSubmit: (a: Record<string, Answer>) => void;
}) {
  const pages = useMemo(() => paginate(form.questions), [form.questions]);
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [err, setErr] = useState<string | null>(null);

  const current = pages[Math.min(page, pages.length - 1)];
  const set = (id: string, v: Answer) => setAnswers((s) => ({ ...s, [id]: v }));

  const missing = (items: Question[]) =>
    items.find((q) => {
      if (!q.required || !isAnswerable(q)) return false;
      const v = answers[q.id];
      return !v || v === "" || (Array.isArray(v) && v.length === 0);
    });

  /** Follow branching rules on this page; returns next page index or -1 to submit. */
  const nextPageIndex = () => {
    for (const q of current.items) {
      const v = answers[q.id];
      const target = typeof v === "string" ? q.goTo?.[v] : undefined;
      if (!target) continue;
      if (target === "__end") return -1;
      const idx = pages.findIndex((p) => p.section?.id === target);
      if (idx >= 0) return idx;
    }
    return page + 1 < pages.length ? page + 1 : -1;
  };

  const goNext = () => {
    const bad = missing(current.items);
    if (bad) {
      setErr(`السؤال "${bad.title}" مطلوب.`);
      return;
    }
    setErr(null);
    const next = nextPageIndex();
    if (next === -1) {
      onSubmit(answers);
      setAnswers({});
      setPage(0);
      setHistory([]);
      return;
    }
    setHistory((h) => [...h, page]);
    setPage(next);
  };

  const goBack = () => {
    setErr(null);
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev === undefined) return h;
      setPage(prev);
      return h.slice(0, -1);
    });
  };

  const isLast = nextPageIndex() === -1;
  const theme = form.theme;
  const fontStack = theme?.font
    ? `"${theme.font}", "Tajawal", "Cairo", sans-serif`
    : undefined;

  return (
    <div
      className={`space-y-4 ${theme ? "rounded-3xl p-3 md:p-4" : ""}`}
      style={{
        ...(theme ? { backgroundColor: theme.background } : null),
        ...(fontStack ? { fontFamily: fontStack } : null),
      }}
    >
      <div
        className="surface-card overflow-hidden p-5 md:p-6"
        style={
          theme
            ? { backgroundColor: theme.accent, borderColor: theme.dark, color: "#fff" }
            : undefined
        }
      >
        {form.headerImage && (
          <DriveImage
            id={form.headerImage}
            alt="صورة النموذج"
            className="mb-4 max-h-56 w-full rounded-xl border border-white/30 object-cover"
          />
        )}
        <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">{form.title}</h2>
        {form.description && (
          <p
            className="mt-2 text-sm text-muted-foreground"
            style={theme ? { color: "rgba(255,255,255,.88)" } : undefined}
          >
            {form.description}
          </p>
        )}
        {pages.length > 1 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
              <span>
                القسم {page + 1} من {pages.length}
              </span>
              {current.section?.title && <span>{current.section.title}</span>}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${((page + 1) / pages.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {current.section && (
        <div
          className="surface-card overflow-hidden"
          style={theme ? { borderColor: theme.dark } : undefined}
        >
          <div
            className={`${theme ? "" : "bg-accent/60"} px-5 py-4`}
            style={theme ? { backgroundColor: theme.accent, color: "#fff" } : undefined}
          >
            <h3 className="text-lg font-extrabold tracking-tight">{current.section.title}</h3>
          </div>
          {current.section.description && (
            <p className="px-5 py-3 text-xs text-muted-foreground">{current.section.description}</p>
          )}
        </div>
      )}

      {current.items.map((q, i) => (
        <div key={q.id} className="surface-card p-5">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-xs font-bold text-muted-foreground tabular">{i + 1}.</span>
            <h3 className="text-base font-bold">
              {q.title}
              {q.required && (
                <span className="ms-1 text-destructive" aria-label="مطلوب">
                  *
                </span>
              )}
            </h3>
          </div>
          {q.description && (
            <p className="mb-3 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {q.description}
            </p>
          )}
          {q.image && (
            <img src={q.image} alt={q.title} className="mb-3 max-h-64 rounded-xl border border-border" />
          )}
          {(q.images ?? []).map((id) => (
            <DriveImage key={id} id={id} alt={q.title || "صورة السؤال"} />
          ))}
          {isAnswerable(q) || (q.type === "unknown" && q.options.length > 0) ? (
            <FieldInput q={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
          ) : null}
        </div>
      ))}

      {err && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {err}
        </p>
      )}

      <div className="flex items-center gap-2">
        {history.length > 0 && (
          <button
            onClick={goBack}
            className={`rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold transition hover:bg-secondary ${focusRing}`}
          >
            السابق
          </button>
        )}
        <button
          onClick={goNext}
          className={`rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition hover:opacity-90 ${focusRing}`}
        >
          {isLast ? "إرسال" : "التالي"}
        </button>
      </div>
    </div>
  );
}
