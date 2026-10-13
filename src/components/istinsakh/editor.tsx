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
import { Download, Share2, Layers, Plus, FileUp } from "lucide-react";
import type { FormDoc, Question } from "@/lib/form-types";
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
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
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
