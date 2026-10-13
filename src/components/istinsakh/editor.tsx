import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Download, Share2, Layers, Plus, FileUp, GraduationCap, X, Palette, Copy, Check } from "lucide-react";
import type { FormDoc, Question } from "@/lib/form-types";
import { driveImageUrl, shadeHex } from "@/lib/form-types";
import { QuestionEditor } from "./question-editor";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const toolBtn = `inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold transition hover:bg-secondary ${focusRing}`;

export function Editor({
  form,
  onUpdate,
  onUpdateQ,
  onAdd,
  onAddSection,
  onRemove,
  onDup,
  onMove,
  onReorder,
  onExport,
  onExportGoogle,
  onShare,
}: {
  form: FormDoc;
  onUpdate: (p: Partial<FormDoc>) => void;
  onUpdateQ: (id: string, p: Partial<Question>) => void;
  onAdd: () => void;
  onAddSection: () => void;
  onRemove: (id: string) => void;
  onDup: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onReorder: (questions: Question[]) => void;
  onExport: () => void;
  onExportGoogle: () => void;
  onShare: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sections = form.questions.filter((q) => q.type === "section");
  const theme = form.theme;
  const [copied, setCopied] = useState<string | null>(null);

  const copyHex = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      prompt("انسخ الكود:", hex);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = form.questions.findIndex((q) => q.id === active.id);
    const to = form.questions.findIndex((q) => q.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(form.questions, from, to));
  };

  return (
    <div className="space-y-4">
      <div className="surface-card p-5 md:p-6">
        <label className="sr-only" htmlFor="form-title">
          عنوان النموذج
        </label>
        <input
          id="form-title"
          value={form.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          className="w-full border-none bg-transparent text-2xl font-extrabold tracking-tight outline-none md:text-3xl"
          placeholder="عنوان النموذج"
        />
        <textarea
          value={form.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          aria-label="وصف النموذج"
          className="mt-3 w-full resize-none border-none bg-transparent text-sm text-muted-foreground outline-none"
          rows={2}
          placeholder="وصف اختياري..."
        />
        {form.headerImage && (
          <div className="relative mt-3">
            <img
              src={driveImageUrl(form.headerImage)}
              alt="صورة ترويسة النموذج"
              className="max-h-48 w-full rounded-xl border border-border object-cover"
            />
            <button
              onClick={() => onUpdate({ headerImage: undefined })}
              aria-label="إزالة صورة الترويسة"
              className={`absolute top-2 left-2 grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:text-destructive ${focusRing}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}
        {theme && (
          <div className="mt-3 rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="text-xs font-extrabold">هوية النموذج الأصلي</p>
              <button
                onClick={() => onUpdate({ theme: undefined })}
                className={`ms-auto rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-destructive ${focusRing}`}
              >
                إزالة
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                <span
                  className="h-7 w-7 rounded-lg border border-border"
                  style={{ backgroundColor: theme.accent }}
                  aria-hidden
                />
                <input
                  type="color"
                  value={theme.accent}
                  aria-label="اللون الأساسي"
                  onChange={(e) =>
                    onUpdate({
                      theme: { ...theme, accent: e.target.value.toUpperCase(), dark: shadeHex(e.target.value, -16) },
                    })
                  }
                  className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <button
                  onClick={() => copyHex(theme.accent)}
                  className={`flex items-center gap-1 rounded-md px-1.5 py-1 font-mono tabular hover:bg-secondary ${focusRing}`}
                  title="نسخ الكود"
                  dir="ltr"
                >
                  {copied === theme.accent ? (
                    <Check className="h-3 w-3 text-primary" aria-hidden />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden />
                  )}
                  {theme.accent}
                </button>
              </label>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                <span
                  className="h-7 w-7 rounded-lg border border-border"
                  style={{ backgroundColor: theme.background }}
                  aria-hidden
                />
                <input
                  type="color"
                  value={theme.background}
                  aria-label="لون الخلفية"
                  onChange={(e) =>
                    onUpdate({ theme: { ...theme, background: e.target.value.toUpperCase() } })
                  }
                  className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <button
                  onClick={() => copyHex(theme.background)}
                  className={`flex items-center gap-1 rounded-md px-1.5 py-1 font-mono tabular hover:bg-secondary ${focusRing}`}
                  title="نسخ الكود"
                  dir="ltr"
                >
                  {copied === theme.background ? (
                    <Check className="h-3 w-3 text-primary" aria-hidden />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden />
                  )}
                  {theme.background}
                </button>
              </label>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                الخط
                <select
                  value={theme.font}
                  onChange={(e) => onUpdate({ theme: { ...theme, font: e.target.value } })}
                  className={`rounded-lg border border-input bg-surface px-2 py-1.5 outline-none ${focusRing}`}
                >
                  {["Cairo", "Tajawal", "Roboto", "Arial", "Noto Kufi Arabic", "Amiri"].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              تُطبَّق الهوية تلقائياً على المعاينة ورابط المشاركة. وفي Google Forms (لا يقبل الألوان
              برمجياً): افتح النموذج ← أيقونة الألوان 🎨 ← لون مخصص والصق الكود.
            </p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <label
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
              form.isQuiz
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border bg-surface hover:bg-secondary"
            } ${focusRing}`}
            title="عند التصدير إلى Google Forms سيُنشأ كاختبار بدرجات"
          >
            <input
              type="checkbox"
              checked={!!form.isQuiz}
              onChange={(e) => onUpdate({ isQuiz: e.target.checked })}
              className="accent-primary"
            />
            <GraduationCap className="h-3.5 w-3.5" aria-hidden /> وضع اختبار
          </label>
          <button onClick={onExport} className={toolBtn}>
            <Download className="h-3.5 w-3.5" aria-hidden /> تصدير JSON
          </button>
          <button onClick={onExportGoogle} className={toolBtn}>
            <FileUp className="h-3.5 w-3.5" aria-hidden /> تصدير إلى Google Forms
          </button>
          <button onClick={onShare} className={toolBtn}>
            <Share2 className="h-3.5 w-3.5" aria-hidden /> نسخ رابط المشاركة
          </button>
        </div>
        {form.sourceUrl && (
          <p className="mt-3 truncate text-[11px] text-muted-foreground" dir="ltr">
            source: {form.sourceUrl}
          </p>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={form.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {form.questions.map((q, i) => (
              <QuestionEditor
                key={q.id}
                q={q}
                index={i + 1}
                sections={sections.filter((s) => s.id !== q.id)}
                quiz={!!form.isQuiz}
                onChange={(p) => onUpdateQ(q.id, p)}
                onRemove={() => onRemove(q.id)}
                onDup={() => onDup(q.id)}
                onMove={(d) => onMove(q.id, d)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={onAdd}
          className={`flex-1 rounded-2xl border-2 border-dashed border-border bg-surface/50 py-4 text-sm font-bold text-muted-foreground transition hover:border-primary/40 hover:bg-accent hover:text-accent-foreground ${focusRing}`}
        >
          <Plus className="inline h-4 w-4" aria-hidden /> إضافة سؤال
        </button>
        <button
          onClick={onAddSection}
          className={`rounded-2xl border-2 border-dashed border-border bg-surface/50 px-6 py-4 text-sm font-bold text-muted-foreground transition hover:border-primary/40 hover:bg-accent hover:text-accent-foreground ${focusRing}`}
        >
          <Layers className="inline h-4 w-4" aria-hidden /> إضافة قسم
        </button>
      </div>
    </div>
  );
}
