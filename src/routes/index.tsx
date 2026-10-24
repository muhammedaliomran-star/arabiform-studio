import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchGoogleForm } from "@/lib/google-form.functions";
import { Header } from "@/components/istinsakh/header";
import { Importer } from "@/components/istinsakh/importer";
import { Editor } from "@/components/istinsakh/editor";
import { Filler } from "@/components/istinsakh/filler";
import { Responses, ResponsesToolbar } from "@/components/istinsakh/responses";
import { DocImportDialog } from "@/components/istinsakh/doc-import-dialog";
import { useFormsStore } from "@/hooks/use-forms-store";
import { TEMPLATES, templateToForm } from "@/lib/form-templates";
import type { Answer, FormDoc, Question, Store, FormResponse } from "@/lib/form-types";
import { isAnswerable, newQuestion, uid } from "@/lib/form-types";
import { THEME_KEY, encodeForm, exportAppsScript, exportFormJson, exportRestScript, parseFormJson } from "@/lib/form-storage";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [
      { title: "استنساخ — استنسخ أي نموذج جوجل وعدّل عليه بحرية" },
      {
        name: "description",
        content:
          "الصق رابط أي Google Form عام، واستنسخ أسئلته إلى نموذج عربي قابل للتعديل والمعاينة والتصدير — بدون تسجيل دخول، وكل شيء داخل متصفحك.",
      },
      { property: "og:title", content: "استنساخ — نماذج جوجل بلمسة عربية" },
      {
        property: "og:description",
        content: "استنسخ، عدّل، عاين، وصدّر أي Google Form عام باللغة العربية مباشرة في متصفحك.",
      },
    ],
  }),
});

type Mode = "edit" | "fill" | "responses";

function HomePage() {
  const fetchForm = useServerFn(fetchGoogleForm);
  const { store, hydrated, commit, undo, redo, canUndo, canRedo } = useFormsStore();
  const [dark, setDark] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docImportOpen, setDocImportOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  // Light mode is the default for first-time visitors.
  useEffect(() => {
    setDark(localStorage.getItem(THEME_KEY) === "dark");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (hydrated && !activeId && store.forms[0]) setActiveId(store.forms[0].id);
  }, [hydrated, activeId, store.forms]);

  const active = useMemo(
    () => store.forms.find((f) => f.id === activeId) ?? null,
    [store, activeId],
  );

  const addForm = (doc: FormDoc) => {
    commit({ ...store, forms: [doc, ...store.forms] });
    setActiveId(doc.id);
    setMode("edit");
    // تنبيه: أسئلة بلا عنوان وبلا صور = غالباً نسخة فاقدة للصور وليست الأصل
    const stripped = doc.questions.filter(
      (q) => !q.title.trim() && q.options.length > 0 && !(q.images ?? []).length && q.type === "radio",
    ).length;
    if (stripped >= 3) {
      toast.warning(
        `تنبيه: ${stripped} سؤال بدون عنوان وبدون صور — إما أن الرابط نسخة فاقدة لصورها فاستنسخ من الأصل، أو تعذّرت قراءة صور الأصل فأبلغنا بالرابط.`,
        { duration: 9000 },
      );
    }
  };

  const handleImport = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchForm({ data: { url } });
      addForm({
        id: uid(),
        title: data.title,
        description: data.description,
        sourceUrl: data.sourceUrl,
        headerImage: (data as any).headerImage,
        isQuiz: (data as any).isQuiz,
        theme: (data as any).theme,
        questions: data.questions.map((q: any) => ({ ...q, id: uid() })) as Question[],
        updatedAt: Date.now(),
      });
      setUrl("");
      toast.success("تم استنساخ النموذج بنجاح");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير معروف أثناء قراءة النموذج.");
    } finally {
      setLoading(false);
    }
  };

  const handleImportJson = async (file: File) => {
    try {
      addForm(parseFormJson(await file.text()));
      toast.success("تم استيراد النموذج من الملف");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر قراءة الملف.");
    }
  };

  const handleImportDoc = (questions: Question[]) => {
    if (!questions.length) return;
    // أي إجابة صحيحة مستوردة (الخيار المظلل بالأصفر في الوورد) تفعّل وضع
    // الاختبار تلقائياً حتى تُصحَّح الإجابات في المعاينة ويُصدَّر النموذج كاختبار.
    const withCorrect = questions.filter((q) => (q.correct?.length ?? 0) > 0).length;
    const hasCorrect = withCorrect > 0;
    // النصوص الوصفية (المقروءات) تُستورد ككتل نصية بدون إجابة
    const texts = questions.filter((q) => q.type === "text").length;
    const qsCount = questions.length - texts;
    const textNote = texts > 0 ? ` + ${texts} نص وصفي (مقروءة)` : "";
    const correctNote = hasCorrect
      ? ` — ${withCorrect} إجابة صحيحة محددة تلقائياً${active && !active.isQuiz ? " ووضع الاختبار مفعّل" : ""}`
      : "";
    if (active) {
      // أضف الأسئلة المستوردة إلى نهاية النموذج النشط
      updateActive({
        questions: [...active.questions, ...questions],
        ...(hasCorrect && !active.isQuiz ? { isQuiz: true } : {}),
      });
      toast.success(
        `تمت إضافة ${qsCount} سؤالاً${textNote} إلى "${active.title}"${correctNote}`,
        { duration: 8000 },
      );
    } else {
      // أنشئ نموذجاً جديداً من الأسئلة المستوردة
      addForm({
        id: uid(),
        title: "مستورد من ملف",
        description: "",
        isQuiz: hasCorrect || undefined,
        questions,
        updatedAt: Date.now(),
      });
      toast.success(`تم إنشاء نموذج من ${qsCount} سؤالاً${textNote}${correctNote}`);
    }
    setDocImportOpen(false);
  };

  const deleteAllForms = () => {
    if (
      !confirm(
        `هل أنت متأكد؟ سيتم حذف كل النماذج (${store.forms.length}) نهائيًا ولا يمكن التراجع.`
      )
    )
      return;
    commit({ forms: [], responses: {} });
    setActiveId(null);
    setMode("edit");
    toast.success("تم حذف جميع النماذج");
  };

  const handleTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key);
    if (t) addForm(templateToForm(t));
  };

  const createBlank = () =>
    addForm({
      id: uid(),
      title: "نموذج جديد",
      description: "",
      questions: [{ ...newQuestion("short"), title: "سؤالك الأول", options: [] }],
      updatedAt: Date.now(),
    });

  const updateActive = (patch: Partial<FormDoc>) => {
    if (!active) return;
    const next: Store = {
      ...store,
      forms: store.forms.map((f) =>
        f.id === active.id ? { ...f, ...patch, updatedAt: Date.now() } : f,
      ),
    };
    commit(next);
  };

  const updateQ = (qid: string, patch: Partial<Question>) => {
    if (!active) return;
    updateActive({
      questions: active.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)),
    });
  };

  const removeQuestion = (qid: string) =>
    active && updateActive({ questions: active.questions.filter((q) => q.id !== qid) });

  const duplicateQuestion = (qid: string) => {
    if (!active) return;
    const idx = active.questions.findIndex((x) => x.id === qid);
    if (idx < 0) return;
    const next = [...active.questions];
    next.splice(idx + 1, 0, { ...active.questions[idx], id: uid() });
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
    commit({ forms, responses });
    if (activeId === id) setActiveId(forms[0]?.id ?? null);
    toast("تم حذف النموذج", { action: { label: "تراجع", onClick: undo } });
  };

  const submitResponse = (answers: Record<string, Answer>) => {
    if (!active) return;
    const list = store.responses[active.id] ?? [];
    commit({
      ...store,
      responses: {
        ...store.responses,
        [active.id]: [...list, { id: uid(), submittedAt: Date.now(), answers }],
      },
    });
    setMode("responses");
    toast.success("تم تسجيل الرد");
  };

  const shareActive = async () => {
    if (!active) return;
    const link = `${window.location.origin}/share#d=${encodeForm(active)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("تم نسخ رابط المشاركة");
    } catch {
      prompt("انسخ الرابط:", link);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <Header
        dark={dark}
        onToggleTheme={() => setDark((v) => !v)}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 md:px-8">
        <Importer
          url={url}
          setUrl={setUrl}
          onImport={handleImport}
          onBlank={createBlank}
          onImportJson={handleImportJson}
          onImportDoc={() => setDocImportOpen(true)}
          onTemplate={handleTemplate}
          loading={loading}
          error={error}
          compact={store.forms.length > 0}
        />

        <DocImportDialog
          open={docImportOpen}
          onOpenChange={setDocImportOpen}
          onImport={handleImportDoc}
        />

        <div className="mt-8 grid gap-8 md:grid-cols-[240px_1fr]">
          <aside className="space-y-2">
            <h2 className="mb-3 text-sm font-bold tracking-tight text-muted-foreground">
              نماذجك ({store.forms.length})
            </h2>
            {store.forms.length > 0 && (
              <button
                onClick={deleteAllForms}
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              >
                مسح كل النماذج ({store.forms.length})
              </button>
            )}
            {store.forms.length === 0 && (
              <p className="text-sm text-muted-foreground">
                لا توجد نماذج بعد. الصق رابطًا أو ابدأ من الصفر.
              </p>
            )}
            <ul className="space-y-1.5">
              {store.forms.map((f) => (
                <li
                  key={f.id}
                  className={`group flex items-start gap-1 rounded-xl border transition ${
                    f.id === activeId
                      ? "border-primary/40 bg-accent text-accent-foreground"
                      : "border-border bg-surface hover:bg-secondary"
                  }`}
                >
                  <button
                    onClick={() => {
                      setActiveId(f.id);
                      setMode("edit");
                    }}
                    className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block truncate text-sm font-semibold">{f.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {f.questions.filter(isAnswerable).length} سؤال
                      {f.isQuiz ? " • اختبار" : ""}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("حذف هذا النموذج نهائيًا؟")) deleteForm(f.id);
                    }}
                    aria-label={`حذف ${f.title}`}
                    className="me-1 mt-2.5 rounded px-2 py-1 text-xs text-muted-foreground opacity-100 transition hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  >
                    حذف
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section>
            {!active && <EmptyState onTemplate={handleTemplate} onBlank={createBlank} />}
            {active && (
              <>
                <Tabs
                  mode={mode}
                  setMode={setMode}
                  responseCount={(store.responses[active.id] ?? []).length}
                />
                {mode === "edit" && (
                  <Editor
                    form={active}
                    onUpdate={updateActive}
                    onUpdateQ={updateQ}
                    onAdd={() => updateActive({ questions: [...active.questions, newQuestion()] })}
                    onAddSection={() =>
                      updateActive({ questions: [...active.questions, newQuestion("section")] })
                    }
                    onRemove={removeQuestion}
                    onDup={duplicateQuestion}
                    onMove={moveQuestion}
                    onReorder={(questions) => updateActive({ questions })}
                    onExport={() => exportFormJson(active)}
                    onExportGoogle={() => {
                      exportAppsScript(active);
                      const keyless = active.isQuiz
                        ? active.questions.filter(
                            (q) =>
                              (q.type === "radio" || q.type === "checkbox" || q.type === "dropdown") &&
                              !(q.correct ?? []).length,
                          ).length
                        : 0;
                      if (keyless > 0) {
                        toast.warning(
                          `تم التنزيل لكن ${keyless} سؤال بلا مفتاح إجابة — لن تُصحح تلقائياً. علّم ✓ أو اجلب المفاتيح من رابط النتيجة ثم صدّر من جديد.`,
                          { duration: 10000 },
                        );
                      } else {
                        toast.success(
                          active.theme
                            ? "تم تنزيل السكربت — شغّله في script.google.com، وانسخ الألوان من بطاقة الهوية وطبّقها من 🎨 في جوجل"
                            : "تم تنزيل السكربت — الصقه في script.google.com، اختر buildForm ثم اضغط تشغيل",
                          {
                            duration: 9000,
                          },
                        );
                      }
                    }}
                    onExportRest={() => {
                      exportRestScript(active);
                      toast.success(
                        "تم تنزيل سكربت البلوك الموحد — طبّق خطوة الـ manifest مرة واحدة (التعليمات أول الملف) ثم اختر buildFormRest وشغّل",
                        { duration: 10000 },
                      );
                    }}
                    onShare={shareActive}
                  />
                )}
                {mode === "fill" && <Filler form={active} onSubmit={submitResponse} />}
                {mode === "responses" && (
                  <div className="space-y-6">
                    <ResponsesToolbar
                      formId={active.id}
                      onImport={(newResponses: FormResponse[]) => {
                        const existing = store.responses[active.id] ?? [];
                        commit({
                          ...store,
                          responses: {
                            ...store.responses,
                            [active.id]: [...existing, ...newResponses],
                          },
                        });
                        toast.success(`تم استيراد ${newResponses.length} رد`);
                      }}
                    />
                    <Responses form={active} responses={store.responses[active.id] ?? []} />
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function EmptyState({
  onTemplate,
  onBlank,
}: {
  onTemplate: (key: string) => void;
  onBlank: () => void;
}) {
  return (
    <div className="surface-card overflow-hidden">
      <div className="border-b border-border bg-accent/40 px-6 py-10 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary text-2xl font-black text-primary-foreground">
          إ
        </div>
        <p className="mt-4 text-xl font-extrabold tracking-tight">ابدأ نموذجك الأول</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          الصق رابط Google Form عام في الأعلى، أو جرّب أحد النماذج الجاهزة بنقرة واحدة.
        </p>
      </div>
      <div className="grid gap-3 p-6 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            onClick={() => onTemplate(t.key)}
            className="rounded-2xl border border-border bg-surface p-4 text-right transition hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="block text-sm font-bold">{t.label}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {t.questions.length} أسئلة — جرّبها الآن
            </span>
          </button>
        ))}
      </div>
      <div className="border-t border-border px-6 py-4">
        <button
          onClick={onBlank}
          className="text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          أو ابدأ من نموذج فارغ ←
        </button>
      </div>
    </div>
  );
}

function Tabs({
  mode,
  setMode,
  responseCount,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  responseCount: number;
}) {
  const tabs: Array<{ k: Mode; label: string; badge?: number }> = [
    { k: "edit", label: "التعديل" },
    { k: "fill", label: "المعاينة والتعبئة" },
    { k: "responses", label: "الردود", badge: responseCount },
  ];
  return (
    <div role="tablist" className="mb-5 flex gap-1 rounded-2xl border border-border bg-surface p-1">
      {tabs.map((t) => (
        <button
          key={t.k}
          role="tab"
          aria-selected={mode === t.k}
          onClick={() => setMode(t.k)}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
