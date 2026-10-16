import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Copy, Trash2, ImagePlus, X, ChevronUp, ChevronDown } from "lucide-react";
import type { Question, QType } from "@/lib/form-types";
import { TYPE_LABEL, OPTION_TYPES, extractDriveId } from "@/lib/form-types";
import { MAX_UPLOAD_CHARS, compressImageFile } from "@/lib/image-compress";
import { DriveImage } from "./drive-image";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function QuestionEditor({
  q,
  index,
  sections,
  quiz,
  onChange,
  onRemove,
  onDup,
  onMove,
}: {
  q: Question;
  index: number;
  sections: Question[];
  quiz: boolean;
  onChange: (p: Partial<Question>) => void;
  onRemove: () => void;
  onDup: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: q.id,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [driveIdInput, setDriveIdInput] = useState("");

  const addDriveId = () => {
    const v = extractDriveId(driveIdInput);
    if (!v) return;
    if (!(q.images ?? []).includes(v)) onChange({ images: [...(q.images ?? []), v] });
    setDriveIdInput("");
  };

  /** Downscale uploaded photos (max 740px, JPEG) so they stay exportable. */
  const compressImage = (file: File): Promise<string> => compressImageFile(file);
  const hasOptions = OPTION_TYPES.includes(q.type as QType) && q.type !== "scale";
  const isSection = q.type === "section";
  const noAnswer = q.type === "section" || q.type === "text" || q.type === "image";
  const branchable = q.type === "radio" || q.type === "dropdown";
  const gradable = quiz && (q.type === "radio" || q.type === "checkbox");
  const correct = q.correct ?? [];

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
        {quiz && !noAnswer && (
          <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <input
              type="number"
              min={0}
              max={100}
              value={q.points ?? 0}
              aria-label="درجات السؤال"
              title="درجات السؤال"
              onChange={(e) => onChange({ points: Number(e.target.value) })}
              className={`w-16 rounded-lg border border-input bg-surface px-2 py-1.5 tabular ${focusRing}`}
            />
            درجة
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
        placeholder={isSection ? "عنوان القسم" : q.type === "text" ? "النص الوصفي" : "نص السؤال"}
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
      {(q.images ?? []).map((id) => (
        <div key={id} className="relative mt-3 inline-block me-2">
          <DriveImage
            id={id}
            alt="صورة السؤال من جوجل"
            className="max-h-56 rounded-xl border border-border"
            onReplace={() => {
              onChange({ images: (q.images ?? []).filter((x) => x !== id) });
              fileRef.current?.click();
            }}
          />
          <button
            onClick={() => onChange({ images: (q.images ?? []).filter((x) => x !== id) })}
            aria-label="إزالة الصورة"
            className={`absolute -top-2 -left-2 grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:text-destructive ${focusRing}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
      {q.type !== "section" && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={driveIdInput}
            onChange={(e) => setDriveIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addDriveId();
            }}
            placeholder="Drive ID من درايفك (اختياري)"
            dir="ltr"
            aria-label="Drive ID من درايفك"
            className={`min-w-0 flex-1 rounded-lg border border-input bg-surface px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring ${focusRing}`}
          />
          <button
            onClick={addDriveId}
            className={`rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-secondary ${focusRing}`}
          >
            إضافة صورة
          </button>
        </div>
      )}

      {q.validation && (
        <p className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-muted-foreground">
          قاعدة تحقق منسوخة: النص يجب أن يحتوي على «{q.validation.args[0]}»
          {q.validation.message ? ` — رسالة الخطأ: ${q.validation.message}` : ""} (تُطبَّق عند التصدير
          إلى Google Forms)
        </p>
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
                  const old = next[i];
                  next[i] = e.target.value;
                  const patch: Partial<Question> = { options: next };
                  // مزامنة مفتاح الإجابة مع النص الجديد حتى لا ييتم
                  if ((q.correct ?? []).includes(old)) {
                    patch.correct = (q.correct ?? []).map((c) => (c === old ? e.target.value : c));
                  }
                  onChange(patch);
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
              {gradable && (
                <label
                  className={`flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold transition ${
                    correct.includes(opt)
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                  title={q.type === "radio" ? "تحديد الإجابة الصحيحة" : "تحديد إجابة صحيحة"}
                >
                  <input
                    type={q.type === "radio" ? "radio" : "checkbox"}
                    name={`correct-${q.id}`}
                    checked={correct.includes(opt)}
                    onChange={() => {
                      if (q.type === "radio") onChange({ correct: [opt] });
                      else
                        onChange({
                          correct: correct.includes(opt)
                            ? correct.filter((c) => c !== opt)
                            : [...correct, opt],
                        });
                    }}
                    className="accent-primary"
                  />
                  ✓ صحيح
                </label>
              )}
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
            if (!f.type.startsWith("image/")) {
              alert("اختر ملف صورة.");
              return;
            }
            if (f.size > 8 * 1024 * 1024) {
              alert("الصورة أكبر من 8 ميجابايت.");
              return;
            }
            compressImage(f)
              .then((dataUrl) => {
                if (dataUrl.length > MAX_UPLOAD_CHARS) {
                  alert("الصورة كبيرة — ستظهر للعرض فقط ولن تُضمَّن في التصدير لجوجل.");
                }
                onChange({ image: dataUrl });
              })
              .catch(() => alert("تعذر قراءة الصورة."));
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
