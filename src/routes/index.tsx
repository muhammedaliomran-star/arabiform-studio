import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { fetchGoogleForm } from "@/lib/google-form.functions";

export const Route = createFileRoute("/")({
  component: HomePage,
});

type QType =
  | "short"
  | "paragraph"
  | "radio"
  | "checkbox"
  | "dropdown"
  | "scale"
  | "date"
  | "time";

type Question = {
  id: string;
  title: string;
  description: string;
  type: QType | "unknown";
  required: boolean;
  options: string[];
};

type FormDoc = {
  id: string;
  title: string;
  description: string;
  sourceUrl?: string;
  questions: Question[];
  updatedAt: number;
};

type Answer = string | string[];
type Response = { id: string; submittedAt: number; answers: Record<string, Answer> };

const STORAGE_KEY = "istinsakh:v1";
const THEME_KEY = "istinsakh:theme";

const TYPE_LABEL: Record<QType, string> = {
  short: "إجابة قصيرة",
  paragraph: "فقرة",
  radio: "اختيار من متعدد",
  checkbox: "مربعات اختيار",
  dropdown: "قائمة منسدلة",
  scale: "مقياس خطي",
  date: "تاريخ",
  time: "وقت",
};

const uid = () => Math.random().toString(36).slice(2, 10);

function loadStore(): { forms: FormDoc[]; responses: Record<string, Response[]> } {
  if (typeof window === "undefined") return { forms: [], responses: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { forms: [], responses: {} };
    return JSON.parse(raw);
  } catch {
    return { forms: [], responses: {} };
  }
}

function saveStore(store: { forms: FormDoc[]; responses: Record<string, Response[]> }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function HomePage() {
  const fetchForm = useServerFn(fetchGoogleForm);
  const [dark, setDark] = useState(false);
  const [store, setStore] = useState<{ forms: FormDoc[]; responses: Record<string, Response[]> }>({
    forms: [],
    responses: {},
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "fill" | "responses">("edit");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadStore();
    setStore(saved);
    if (saved.forms[0]) setActiveId(saved.forms[0].id);
    const t = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const isDark = t ? t === "dark" : Boolean(prefersDark);
    setDark(isDark);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    if (typeof window !== "undefined") localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  const active = useMemo(
    () => store.forms.find((f) => f.id === activeId) ?? null,
    [store, activeId],
  );

  const persist = (next: typeof store) => {
    setStore(next);
    saveStore(next);
  };

  const handleImport = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchForm({ data: { url } });
      const doc: FormDoc = {
        id: uid(),
        title: data.title,
        description: data.description,
        sourceUrl: data.sourceUrl,
        questions: data.questions.map((q) => ({ ...q, id: uid() })),
        updatedAt: Date.now(),
      };
      const next = { ...store, forms: [doc, ...store.forms] };
      persist(next);
      setActiveId(doc.id);
      setMode("edit");
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setLoading(false);
    }
  };

  const createBlank = () => {
    const doc: FormDoc = {
      id: uid(),
      title: "نموذج جديد",
      description: "",
      questions: [
        { id: uid(), title: "سؤالك الأول", description: "", type: "short", required: false, options: [] },
      ],
      updatedAt: Date.now(),
    };
    persist({ ...store, forms: [doc, ...store.forms] });
    setActiveId(doc.id);
    setMode("edit");
  };

  const updateActive = (patch: Partial<FormDoc>) => {
    if (!active) return;
    const next = {
      ...store,
      forms: store.forms.map((f) =>
        f.id === active.id ? { ...f, ...patch, updatedAt: Date.now() } : f,
      ),
    };
    persist(next);
  };

  const updateQ = (qid: string, patch: Partial<Question>) => {
    if (!active) return;
    updateActive({
      questions: active.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)),
    });
  };

  const addQuestion = () => {
    if (!active) return;
    updateActive({
      questions: [
        ...active.questions,
        { id: uid(), title: "سؤال جديد", description: "", type: "short", required: false, options: [] },
      ],
    });
  };

  const removeQuestion = (qid: string) => {
    if (!active) return;
    updateActive({ questions: active.questions.filter((q) => q.id !== qid) });
  };

  const duplicateQuestion = (qid: string) => {
    if (!active) return;
    const q = active.questions.find((x) => x.id === qid);
    if (!q) return;
    const copy = { ...q, id: uid(), title: q.title };
    const idx = active.questions.findIndex((x) => x.id === qid);
    const next = [...active.questions];
    next.splice(idx + 1, 0, copy);
    updateActive({ questions: next });
  };

  const moveQuestion = (qid: string, dir: -1 | 1) => {
    if (!active) return;
    const idx = active.questions.findIndex((q) => q.id === qid);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= active.questions.length) return;
    const next = [...active.questions];
    [next[idx], next[j]] = [next[j], next[idx]];
    updateActive({ questions: next });
  };

  const deleteForm = (id: string) => {
    const forms = store.forms.filter((f) => f.id !== id);
    const responses = { ...store.responses };
    delete responses[id];
    persist({ forms, responses });
    if (activeId === id) setActiveId(forms[0]?.id ?? null);
  };

  const submitResponse = (answers: Record<string, Answer>) => {
    if (!active) return;
    const list = store.responses[active.id] ?? [];
    const next = {
      ...store,
      responses: {
        ...store.responses,
        [active.id]: [...list, { id: uid(), submittedAt: Date.now(), answers }],
      },
    };
    persist(next);
    setMode("responses");
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <Header dark={dark} onToggleTheme={() => setDark((v) => !v)} />

      <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-6 md:px-8">
        <Importer
          url={url}
          setUrl={setUrl}
          onImport={handleImport}
          onBlank={createBlank}
          loading={loading}
          error={error}
        />

        <div className="mt-10 grid gap-8 md:grid-cols-[260px_1fr]">
          <aside className="space-y-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight text-muted-foreground">
                نماذجك ({store.forms.length})
              </h2>
            </div>
            {store.forms.length === 0 && (
              <p className="text-sm text-muted-foreground">
                لا توجد نماذج بعد. الصق رابطًا أو ابدأ من الصفر.
              </p>
            )}
            <ul className="space-y-1.5">
              {store.forms.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => {
                      setActiveId(f.id);
                      setMode("edit");
                    }}
                    className={`group flex w-full items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-right transition ${
                      f.id === activeId
                        ? "border-primary/40 bg-accent text-accent-foreground"
                        : "border-border bg-surface hover:bg-secondary"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{f.title}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {f.questions.length} سؤال
                      </span>
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("حذف هذا النموذج نهائيًا؟")) deleteForm(f.id);
                      }}
                      className="opacity-0 transition group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive"
                    >
                      حذف
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section>
            {!active && (
              <EmptyState />
            )}
            {active && (
              <>
                <Tabs mode={mode} setMode={setMode} responseCount={(store.responses[active.id] ?? []).length} />
                {mode === "edit" && (
                  <Editor
                    form={active}
                    onUpdate={updateActive}
                    onUpdateQ={updateQ}
                    onAdd={addQuestion}
                    onRemove={removeQuestion}
                    onDup={duplicateQuestion}
                    onMove={moveQuestion}
                  />
                )}
                {mode === "fill" && <Filler form={active} onSubmit={submitResponse} />}
                {mode === "responses" && (
                  <Responses form={active} responses={store.responses[active.id] ?? []} />
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Header({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <span className="text-lg font-black">إ</span>
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-none tracking-tight">استنساخ</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              انسخ شكل أي Google Form وعدّل عليه محليًا
            </p>
          </div>
        </div>
        <button
          onClick={onToggleTheme}
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold transition hover:bg-secondary"
        >
          {dark ? "الوضع النهاري" : "الوضع الليلي"}
        </button>
      </div>
    </header>
  );
}

function Importer({
  url,
  setUrl,
  onImport,
  onBlank,
  loading,
  error,
}: {
  url: string;
  setUrl: (v: string) => void;
  onImport: () => void;
  onBlank: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="surface-card p-6 md:p-8">
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">
          جديد
        </span>
        <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">
          ألصق رابط نموذج جوجل عام
        </h2>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        نقرأ الأسئلة والخيارات ونحوّلها إلى نموذج قابل للتعديل بالكامل داخل متصفحك.
        لا نرسل أي بيانات لأي جهة، ولا نحتاج تسجيل دخول.
      </p>
      <div className="flex flex-col gap-3 md:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/forms/d/e/.../viewform"
          dir="ltr"
          className="min-w-0 flex-1 rounded-xl border border-input bg-surface px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <button
          onClick={onImport}
          disabled={loading}
          className="rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "جارٍ الاستنساخ..." : "استنسخ الآن"}
        </button>
        <button
          onClick={onBlank}
          className="rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold transition hover:bg-secondary"
        >
          ابدأ من الصفر
        </button>
      </div>
      {error && (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="surface-card grid place-items-center p-16 text-center">
      <p className="text-lg font-bold">اختر نموذجًا من القائمة</p>
      <p className="mt-2 text-sm text-muted-foreground">
        أو ألصق رابط Google Form في الأعلى للبدء.
      </p>
    </div>
  );
}

function Tabs({
  mode,
  setMode,
  responseCount,
}: {
  mode: "edit" | "fill" | "responses";
  setMode: (m: "edit" | "fill" | "responses") => void;
  responseCount: number;
}) {
  const tabs: Array<{ k: typeof mode; label: string; badge?: number }> = [
    { k: "edit", label: "التعديل" },
    { k: "fill", label: "المعاينة والتعبئة" },
    { k: "responses", label: "الردود", badge: responseCount },
  ];
  return (
    <div className="mb-5 flex gap-1 rounded-2xl border border-border bg-surface p-1">
      {tabs.map((t) => (
        <button
          key={t.k}
          onClick={() => setMode(t.k)}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
            mode === t.k
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary"
          }`}
        >
          {t.label}
          {typeof t.badge === "number" && t.badge > 0 && (
            <span className="ms-2 rounded-full bg-background/20 px-2 py-0.5 text-[11px] tabular">
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function Editor({
  form,
  onUpdate,
  onUpdateQ,
  onAdd,
  onRemove,
  onDup,
  onMove,
}: {
  form: FormDoc;
  onUpdate: (p: Partial<FormDoc>) => void;
  onUpdateQ: (id: string, p: Partial<Question>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onDup: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="surface-card p-6">
        <input
          value={form.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          className="w-full border-none bg-transparent text-2xl font-extrabold tracking-tight outline-none md:text-3xl"
          placeholder="عنوان النموذج"
        />
        <textarea
          value={form.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          className="mt-3 w-full resize-none border-none bg-transparent text-sm text-muted-foreground outline-none"
          rows={2}
          placeholder="وصف اختياري..."
        />
        {form.sourceUrl && (
          <p className="mt-3 truncate text-[11px] text-muted-foreground" dir="ltr">
            source: {form.sourceUrl}
          </p>
        )}
      </div>

      {form.questions.map((q, i) => (
        <QuestionEditor
          key={q.id}
          q={q}
          index={i + 1}
          onChange={(p) => onUpdateQ(q.id, p)}
          onRemove={() => onRemove(q.id)}
          onDup={() => onDup(q.id)}
          onMove={(d) => onMove(q.id, d)}
        />
      ))}

      <button
        onClick={onAdd}
        className="w-full rounded-2xl border-2 border-dashed border-border bg-surface/50 py-5 text-sm font-bold text-muted-foreground transition hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
      >
        + إضافة سؤال
      </button>
    </div>
  );
}

function QuestionEditor({
  q,
  index,
  onChange,
  onRemove,
  onDup,
  onMove,
}: {
  q: Question;
  index: number;
  onChange: (p: Partial<Question>) => void;
  onRemove: () => void;
  onDup: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const hasOptions = q.type === "radio" || q.type === "checkbox" || q.type === "dropdown";
  return (
    <div className="surface-card p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-xs font-bold tabular">
          {index}
        </span>
        <select
          value={q.type}
          onChange={(e) => onChange({ type: e.target.value as QType })}
          className="rounded-lg border border-input bg-surface px-3 py-1.5 text-xs font-semibold outline-none"
        >
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label className="ms-auto flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <input
            type="checkbox"
            checked={q.required}
            onChange={(e) => onChange({ required: e.target.checked })}
            className="accent-primary"
          />
          مطلوب
        </label>
      </div>

      <input
        value={q.title}
        onChange={(e) => onChange({ title: e.target.value })}
        className="w-full border-b border-border bg-transparent pb-2 text-base font-bold outline-none focus:border-primary"
        placeholder="نص السؤال"
      />
      <input
        value={q.description}
        onChange={(e) => onChange({ description: e.target.value })}
        className="mt-2 w-full border-none bg-transparent text-xs text-muted-foreground outline-none"
        placeholder="وصف / تلميح (اختياري)"
      />

      {hasOptions && (
        <div className="mt-4 space-y-2">
          {q.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-muted-foreground">•</span>
              <input
                value={opt}
                onChange={(e) => {
                  const next = [...q.options];
                  next[i] = e.target.value;
                  onChange({ options: next });
                }}
                className="flex-1 rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-ring"
              />
              <button
                onClick={() => onChange({ options: q.options.filter((_, j) => j !== i) })}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                إزالة
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ options: [...q.options, `خيار ${q.options.length + 1}`] })}
            className="text-xs font-semibold text-primary hover:underline"
          >
            + إضافة خيار
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <button onClick={() => onMove(-1)} className="rounded px-2 py-1 hover:bg-secondary">↑ أعلى</button>
        <button onClick={() => onMove(1)} className="rounded px-2 py-1 hover:bg-secondary">↓ أسفل</button>
        <button onClick={onDup} className="rounded px-2 py-1 hover:bg-secondary">تكرار</button>
        <button
          onClick={onRemove}
          className="ms-auto rounded px-2 py-1 hover:bg-destructive/10 hover:text-destructive"
        >
          حذف
        </button>
      </div>
    </div>
  );
}

function Filler({
  form,
  onSubmit,
}: {
  form: FormDoc;
  onSubmit: (a: Record<string, Answer>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [err, setErr] = useState<string | null>(null);

  const set = (id: string, v: Answer) => setAnswers((s) => ({ ...s, [id]: v }));

  const submit = () => {
    for (const q of form.questions) {
      if (q.required) {
        const v = answers[q.id];
        if (!v || (Array.isArray(v) && v.length === 0) || v === "") {
          setErr(`السؤال "${q.title}" مطلوب.`);
          return;
        }
      }
    }
    setErr(null);
    onSubmit(answers);
    setAnswers({});
  };

  return (
    <div className="space-y-4">
      <div className="surface-card p-6">
        <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">{form.title}</h2>
        {form.description && (
          <p className="mt-2 text-sm text-muted-foreground">{form.description}</p>
        )}
      </div>
      {form.questions.map((q, i) => (
        <div key={q.id} className="surface-card p-5">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-xs font-bold text-muted-foreground tabular">{i + 1}.</span>
            <h3 className="text-base font-bold">
              {q.title}
              {q.required && <span className="ms-1 text-destructive">*</span>}
            </h3>
          </div>
          {q.description && (
            <p className="mb-3 text-xs text-muted-foreground">{q.description}</p>
          )}
          <FieldInput q={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
        </div>
      ))}
      {err && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </p>
      )}
      <button
        onClick={submit}
        className="rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition hover:opacity-90"
      >
        إرسال
      </button>
    </div>
  );
}

function FieldInput({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
}) {
  const base =
    "w-full rounded-xl border border-input bg-surface px-4 py-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
  if (q.type === "short")
    return <input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={base} />;
  if (q.type === "paragraph")
    return (
      <textarea
        rows={4}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      />
    );
  if (q.type === "date")
    return <input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={base} />;
  if (q.type === "time")
    return <input type="time" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={base} />;
  if (q.type === "dropdown")
    return (
      <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">— اختر —</option>
        {q.options.map((o, i) => (
          <option key={i} value={o}>{o}</option>
        ))}
      </select>
    );
  if (q.type === "scale") {
    const opts = q.options.length ? q.options : ["1", "2", "3", "4", "5"];
    return (
      <div className="flex flex-wrap gap-2">
        {opts.map((o, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(o)}
            className={`h-11 min-w-11 rounded-xl border px-4 text-sm font-bold transition ${
              value === o
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface hover:bg-secondary"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (q.type === "radio")
    return (
      <div className="space-y-2">
        {q.options.map((o, i) => (
          <label key={i} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm transition hover:bg-secondary">
            <input
              type="radio"
              name={q.id}
              checked={value === o}
              onChange={() => onChange(o)}
              className="accent-primary"
            />
            {o}
          </label>
        ))}
      </div>
    );
  if (q.type === "checkbox") {
    const arr = (value as string[]) ?? [];
    return (
      <div className="space-y-2">
        {q.options.map((o, i) => {
          const checked = arr.includes(o);
          return (
            <label key={i} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm transition hover:bg-secondary">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(checked ? arr.filter((x) => x !== o) : [...arr, o])
                }
                className="accent-primary"
              />
              {o}
            </label>
          );
        })}
      </div>
    );
  }
  return <p className="text-xs text-muted-foreground">نوع سؤال غير مدعوم في المعاينة.</p>;
}

function Responses({ form, responses }: { form: FormDoc; responses: Response[] }) {
  if (responses.length === 0)
    return (
      <div className="surface-card grid place-items-center p-16 text-center">
        <p className="text-lg font-bold">لا توجد ردود بعد</p>
        <p className="mt-2 text-sm text-muted-foreground">
          افتح تبويب المعاينة واملأ النموذج لتظهر الردود هنا.
        </p>
      </div>
    );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(responses, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${form.title || "responses"}.json`;
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-extrabold">
          {responses.length} <span className="text-muted-foreground">رد</span>
        </h2>
        <button
          onClick={exportJson}
          className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-secondary"
        >
          تصدير JSON
        </button>
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
              {form.questions.map((q) => {
                const v = r.answers[q.id];
                const display = Array.isArray(v) ? v.join("، ") : v || "—";
                return (
                  <div key={q.id} className="grid gap-1 border-t border-border pt-2 md:grid-cols-[220px_1fr]">
                    <dt className="font-semibold text-muted-foreground">{q.title}</dt>
                    <dd>{display}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
    </div>
  );
}
