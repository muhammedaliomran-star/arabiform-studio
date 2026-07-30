import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Copy, Trash2, ImagePlus, X, ChevronUp, ChevronDown } from "lucide-react";
import type { Question, QType } from "@/lib/form-types";
import { TYPE_LABEL, OPTION_TYPES } from "@/lib/form-types";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function QuestionEditor({
  q,
  index,
  sections,
  onChange,
  onRemove,
  onDup,
  onMove,
}: {
  q: Question;
  index: number;
  sections: Question[];
  onChange: (p: Partial<Question>) => void;
  onRemove: () => void;
  onDup: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: q.id,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const hasOptions = OPTION_TYPES.includes(q.type as QType) && q.type !== "scale";
  const isSection = q.type === "section";
  const branchable = q.type === "radio" || q.type === "dropdown";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`surface-card p-4 md:p-5 ${isDragging ? "z-20 opacity-80 shadow-lg" : ""} ${
        isSection ? "border-primary/40 bg-accent/40" : ""
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          aria-label="اسحب لإعادة الترتيب"
          className={`grid h-8 w-8 cursor-grab place-items-center rounded-lg text-muted-foreground transition hover:bg-secondary active:cursor-grabbing ${focusRing}`}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-xs font-bold tabular">
          {index}
        </span>
        <label className="sr-only" htmlFor={`type-${q.id}`}>
          نوع السؤال
        </label>
        <select
          id={`type-${q.id}`}
          value={q.type}
          onChange={(e) => onChange({ type: e.target.value as QType })}
          className={`rounded-lg border border-input bg-surface px-3 py-1.5 text-xs font-semibold outline-none ${focusRing}`}
        >
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {!isSection && (
          <label className="ms-auto flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <input
              type="checkbox"
              checked={q.required}
              onChange={(e) => onChange({ required: e.target.checked })}
              className="accent-primary"
            />
            مطلوب
          </label>
        )}
      </div>

      <label className="sr-only" htmlFor={`title-${q.id}`}>
        نص السؤال
      </label>
      <input
        id={`title-${q.id}`}
        value={q.title}
        onChange={(e) => onChange({ title: e.target.value })}
        className="w-full border-b border-border bg-transparent pb-2 text-base font-bold outline-none focus:border-primary"
        placeholder={isSection ? "عنوان القسم" : "نص السؤال"}
      />
      <input
        value={q.description}
        onChange={(e) => onChange({ description: e.target.value })}
        aria-label="وصف السؤال"
        className="mt-2 w-full border-none bg-transparent text-xs text-muted-foreground outline-none"
        placeholder="وصف / تلميح (اختياري)"
      />

      {q.image && (
        <div className="relative mt-3 inline-block">
          <img src={q.image} alt="صورة السؤال" className="max-h-56 rounded-xl border border-border" />
          <button
            onClick={() => onChange({ image: undefined })}
            aria-label="إزالة الصورة"
            className={`absolute -top-2 -left-2 grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:text-destructive ${focusRing}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {q.type === "rating" && (
        <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <label htmlFor={`max-${q.id}`}>عدد النجوم</label>
          <input
            id={`max-${q.id}`}
            type="number"
            min={3}
            max={10}
            value={q.max ?? 5}
            onChange={(e) => onChange({ max: Number(e.target.value) })}
            className={`w-20 rounded-lg border border-input bg-surface px-2 py-1 tabular ${focusRing}`}
          />
        </div>
      )}

      {q.type === "scale" && (
        <p className="mt-3 text-xs text-muted-foreground">
          يمكنك تعديل درجات المقياس من قائمة الخيارات أدناه.
        </p>
      )}

      {(hasOptions || q.type === "scale") && (
        <div className="mt-4 space-y-2">
          {q.options.map((opt, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground" aria-hidden>
                •
              </span>
              <input
                value={opt}
                aria-label={`الخيار ${i + 1}`}
                onChange={(e) => {
                  const next = [...q.options];
                  next[i] = e.target.value;
                  onChange({ options: next });
                }}
                className={`min-w-0 flex-1 rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-ring ${focusRing}`}
              />
              {branchable && sections.length > 0 && (
                <select
                  aria-label={`الانتقال بعد اختيار ${opt}`}
                  value={q.goTo?.[opt] ?? ""}
                  onChange={(e) => {
                    const goTo = { ...(q.goTo ?? {}) };
                    if (e.target.value) goTo[opt] = e.target.value;
                    else delete goTo[opt];
                    onChange({ goTo });
                  }}
                  className="rounded-lg border border-input bg-surface px-2 py-2 text-[11px] font-semibold outline-none"
                >
                  <option value="">التالي بالترتيب</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      ← {s.title || "قسم"}
                    </option>
                  ))}
                  <option value="__end">← إنهاء النموذج</option>
                </select>
              )}
              <button
                onClick={() => onChange({ options: q.options.filter((_, j) => j !== i) })}
                aria-label={`إزالة الخيار ${i + 1}`}
                className={`rounded px-2 py-1 text-xs text-muted-foreground hover:text-destructive ${focusRing}`}
              >
                إزالة
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ options: [...q.options, `خيار ${q.options.length + 1}`] })}
            className={`rounded text-xs font-semibold text-primary hover:underline ${focusRing}`}
          >
            + إضافة خيار
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <button onClick={() => onMove(-1)} aria-label="نقل لأعلى" className={`rounded p-1.5 hover:bg-secondary ${focusRing}`}>
          <ChevronUp className="h-4 w-4" aria-hidden />
        </button>
        <button onClick={() => onMove(1)} aria-label="نقل لأسفل" className={`rounded p-1.5 hover:bg-secondary ${focusRing}`}>
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
        {!isSection && (
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="إضافة صورة"
            className={`rounded p-1.5 hover:bg-secondary ${focusRing}`}
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > 1.5 * 1024 * 1024) {
              alert("الصورة أكبر من 1.5 ميجابايت.");
              return;
            }
            const reader = new FileReader();
            reader.onload = () => onChange({ image: String(reader.result) });
            reader.readAsDataURL(f);
          }}
        />
        <button onClick={onDup} aria-label="تكرار السؤال" className={`rounded p-1.5 hover:bg-secondary ${focusRing}`}>
          <Copy className="h-4 w-4" aria-hidden />
        </button>
        <button
          onClick={onRemove}
          aria-label="حذف السؤال"
          className={`ms-auto rounded p-1.5 hover:bg-destructive/10 hover:text-destructive ${focusRing}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
