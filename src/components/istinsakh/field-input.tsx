import { useEffect, useRef, useState } from "react";
import { Star, Eraser, Paperclip } from "lucide-react";
import type { Answer, Question } from "@/lib/form-types";

const base =
  "w-full rounded-xl border border-input bg-surface px-4 py-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

export function FieldInput({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
}) {
  if (q.type === "short")
    return (
      <input
        aria-label={q.title}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      />
    );

  if (q.type === "paragraph")
    return (
      <textarea
        aria-label={q.title}
        rows={4}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      />
    );

  if (q.type === "date" || q.type === "time")
    return (
      <input
        type={q.type}
        aria-label={q.title}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      />
    );

  if (q.type === "dropdown")
    return (
      <select
        aria-label={q.title}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      >
        <option value="">— اختر —</option>
        {q.options.map((o, i) => (
          <option key={i} value={o}>
            {o}
          </option>
        ))}
      </select>
    );

  if (q.type === "scale") {
    const opts = q.options.length ? q.options : ["1", "2", "3", "4", "5"];
    return (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.title}>
        {opts.map((o, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === o}
            onClick={() => onChange(o)}
            className={`h-11 min-w-11 rounded-xl border px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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

  if (q.type === "rating") return <Rating q={q} value={value as string} onChange={onChange} />;
  if (q.type === "signature") return <Signature value={value as string} onChange={onChange} />;
  if (q.type === "file") return <FileField value={value as string} onChange={onChange} />;

  if (q.type === "radio")
    return (
      <div className="space-y-2" role="radiogroup" aria-label={q.title}>
        {q.options.map((o, i) => (
          <label
            key={i}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm transition hover:bg-secondary focus-within:border-ring"
          >
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
            <label
              key={i}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm transition hover:bg-secondary focus-within:border-ring"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(checked ? arr.filter((x) => x !== o) : [...arr, o])}
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

function Rating({ q, value, onChange }: { q: Question; value?: string; onChange: (v: Answer) => void }) {
  const max = q.max && q.max > 0 ? q.max : 5;
  const current = Number(value ?? 0);
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={q.title}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const on = (hover || current) >= n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={`${n} من ${max}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(String(n))}
            className="rounded p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              className={`h-7 w-7 transition ${on ? "fill-primary text-primary" : "text-muted-foreground/40"}`}
              aria-hidden
            />
          </button>
        );
      })}
      {current > 0 && (
        <span className="ms-2 text-sm font-bold tabular text-muted-foreground">
          {current}/{max}
        </span>
      )}
    </div>
  );
}

function Signature({ value, onChange }: { value?: string; onChange: (v: Answer) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = getComputedStyle(c).color;
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        aria-label="مساحة التوقيع"
        className="h-40 w-full touch-none rounded-xl border border-dashed border-input bg-surface text-foreground"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext("2d");
          if (!ctx) return;
          drawing.current = true;
          const { x, y } = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d");
          if (!ctx) return;
          const { x, y } = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          onChange(e.currentTarget.toDataURL("image/png"));
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const c = canvasRef.current;
            const ctx = c?.getContext("2d");
            if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
            onChange("");
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden /> مسح التوقيع
        </button>
        {value && <span className="text-xs text-muted-foreground">تم حفظ التوقيع ✓</span>}
      </div>
    </div>
  );
}

function FileField({ value, onChange }: { value?: string; onChange: (v: Answer) => void }) {
  const [name, setName] = useState("");
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-4 py-4 text-sm transition hover:bg-secondary focus-within:border-ring">
      <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">
        {name || (value ? "تم إرفاق ملف" : "اختر ملفًا (حتى 2 ميجابايت)")}
      </span>
      <input
        type="file"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 2 * 1024 * 1024) {
            alert("الملف أكبر من 2 ميجابايت.");
            return;
          }
          setName(f.name);
          const reader = new FileReader();
          reader.onload = () => onChange(String(reader.result));
          reader.readAsDataURL(f);
        }}
      />
    </label>
  );
}
