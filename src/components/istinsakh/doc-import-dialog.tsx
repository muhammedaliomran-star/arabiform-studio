"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardPaste,
  Eye,
  FileText,
  FileUp,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Question } from "@/lib/form-types";
import { uid } from "@/lib/form-types";
import {
  parseDocText,
  blocksToQuestions,
  type ParsedBlock,
} from "@/lib/doc-parser";
import {
  readFileContent,
  isSupportedTextFile,
  conversionHint,
} from "@/lib/file-readers";
import { cn } from "@/lib/utils";

type DocImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (questions: Question[]) => void;
};

/** مراحل تدفق الاستيراد: اختيار الملف ← التحليل ← المراجعة */
type Stage = "select" | "analyzing" | "review";

/** قسم (مجموعة أسئلة) داخل اختبار متعدد الأقسام -- كما في نماذج Google */
type Section = {
  id: string;
  title: string;
  blocks: ParsedBlock[];
};

/** استنتاج أقسام من كتل مسطحة: كتلة نص (text) قصيرة تُعتبر عنوان قسم، والأسئلة التي تليها تنتمي له */
function deriveSections(blocks: ParsedBlock[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const b of blocks) {
    if (b.kind === "text" && b.title.trim()) {
      if (current) sections.push(current);
      current = { id: "s" + sections.length, title: b.title.trim(), blocks: [b] };
    } else if (current) {
      current.blocks.push(b);
    } else {
      current = { id: "s" + sections.length, title: "القسم 1", blocks: [b] };
    }
  }
  if (current) sections.push(current);
  if (sections.length === 0 && blocks.length > 0) {
    sections.push({ id: "s0", title: "القسم 1", blocks });
  }
  return sections;
}

/** توحيد كلمات صح/خطأ وإزالة الأقوال */
function normTF(s: string): string {
  const t = s.replace(/[（()\s]/g, "");
  return t === "صواب" ? "صح" : t;
}

function isTFWord(s: string): boolean {
  const t = normTF(s);
  return t === "صح" || t === "خطأ";
}

/** تسميات أنواع الأسئلة في قائمة التغيير */
const typeOptions: Array<{ value: ParsedBlock["kind"]; label: string }> = [
  { value: "radio", label: "اختيار من متعدد" },
  { value: "truefalse", label: "صح / خطأ" },
  { value: "checkbox", label: "اختيار من متعدد (عدة إجابات)" },
  { value: "short", label: "مقالي — إجابة قصيرة" },
  { value: "paragraph", label: "مقالي — فقرة" },
  { value: "text", label: "نص وصفي (بدون إجابة)" },
];

function kindLabel(k: ParsedBlock["kind"]): string {
  switch (k) {
    case "radio":
      return "اختيار من متعدد";
    case "checkbox":
      return "اختيار (عدة إجابات)";
    case "truefalse":
      return "صح / خطأ";
    case "short":
      return "مقالي (إجابة قصيرة)";
    case "paragraph":
      return "مقالي (فقرة)";
    default:
      return "نص وصفي";
  }
}

/**
 * سبب كون السؤال "يحتاج إلى مراجعة" — null يعني سؤالاً كاملاً.
 * لا نُخمّن الإجابة أبداً: سؤال الاختيار بلا إجابة محدّدة يحتاج تحديد المستخدم.
 */
function reviewReason(b: ParsedBlock): string | null {
  if (b.kind === "text") {
    return (b.text ?? "").trim() ? null : "نص المقروءة فارغ";
  }
  if (!b.title.trim()) return "نص السؤال فارغ";
  if (b.kind === "radio" || b.kind === "checkbox" || b.kind === "truefalse") {
    const opts = b.options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return "الاختيارات أقل من اثنين";
    if (!b.correct || b.correct.length === 0) return "لم تُحدَّد الإجابة الصحيحة بعد";
    if (b.kind !== "checkbox" && b.correct.length > 1) {
      return b.kind === "truefalse"
        ? "صح/خطأ: حدّد إجابة واحدة"
        : "لاختيار من متعدد: حدّد إجابة واحدة";
    }
  }
  return null;
}

/** حقل الدرجة: يحفظ النص أثناء الكتابة ويرجع قيمة صحيحة عند الخروج */
function PointsInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => {
    setTxt(String(value));
  }, [value]);
  return (
    <input
      type="number"
      min={0}
      step={1}
      value={txt}
      onChange={(e) => {
        setTxt(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(v) && v >= 0) onCommit(v);
      }}
      onBlur={() => {
        const raw = txt.trim();
        const v = Number(raw);
        const next = raw !== "" && Number.isFinite(v) && v >= 0 ? v : 1;
        setTxt(String(next));
        onCommit(next);
      }}
      className="w-14 rounded border border-input bg-background px-1.5 py-1 text-center text-xs outline-none focus:border-ring"
      aria-label="درجة السؤال"
    />
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " م.ب";
  return Math.max(1, Math.round(bytes / 1024)) + " ك.ب";
}

export function DocImportDialog({
  open,
  onOpenChange,
  onImport,
}: DocImportDialogProps) {
  const [stage, setStage] = useState<Stage>("select");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [blocks, setBlocks] = useState<ParsedBlock[]>([]);
  const sections = useMemo(() => deriveSections(blocks), [blocks]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analyzingMsg, setAnalyzingMsg] = useState("");
  const [bulkPoints, setBulkPoints] = useState("1");
  const fileInput = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);

  /* מצב בדיקה (Debug): הצגת טקסט מקורי / לאחר ניקוי / תוצאת המפרש */
  const [debugMode, setDebugMode] = useState(false);
  const [debugView, setDebugView] = useState<"raw" | "cleaned" | "parsed">("raw");
  /* קידום ניתוח בשלבים — להודעות ה-Loading ו_progress bar האמיתי */
  const [progressStage, setProgressStage] = useState<"reading" | "extracting" | "parsing" | "done">("reading");
  const [questionsFound, setQuestionsFound] = useState(0);
  const [parsedPreview, setParsedPreview] = useState("");

  // إعادة تعيين كاملة عند إغلاق النافذة (بغض النظر عن مصدر الإغلاق)
  useEffect(() => {
    openRef.current = open;
    if (open) return;
    setStage("select");
    setPendingFile(null);
    setDragOver(false);
    setBlocks([]);
    setSelected(new Set());
    setRawText("");
    setShowRaw(false);
    setPasteText("");
    setError(null);
    setAnalyzingMsg("");
    setBulkPoints("1");
    setDebugMode(false);
    setProgressStage("reading");
    setQuestionsFound(0);
    setParsedPreview("");

  }, [open]);

  /*============================ التحليل ============================*/
  const analyze = useCallback(async (source: File | string) => {
    setError(null);
    const isFile = typeof source !== "string";
    setProgressStage("reading");
    setQuestionsFound(0);
    setParsedPreview("");

    setAnalyzingMsg(
      isFile
        ? "الجاري: قراءة ملف Word واستخراج النص…"
        : "الجاري: קריאת הטקסט שהודבק…",
    );
    setStage("analyzing");
    try {
      // إفساح للرسم حتى تظهر شاشة التحميل
      await new Promise((r) => setTimeout(r, 150));
      let raw: string;
      if (isFile) {
        const f = source as File;
        if (!isSupportedTextFile(f)) throw new Error(conversionHint(f));
        raw = await readFileContent(f);
      } else {
        raw = source as string;
      }
      if (!openRef.current) return;
      setProgressStage("extracting");
      setAnalyzingMsg(
        isFile
          ? "الجاري: استخراج الفقرات والنصوص من ملف Word…"
          : "الجاري: Preparing text for parsing…",
      );
      const parsed = parseDocText(raw);
      if (!openRef.current) return;
      setProgressStage("parsing");
      setAnalyzingMsg(
        `تحديد الأسئلة والاختيارات — عُثر على ${parsed.length} سؤال حتى الآن…`,
      );
      setQuestionsFound(parsed.length);
      if (isFile) setRawText(raw);
      //almazaj debug preview (cleaned text + parsed result as JSON)
      setParsedPreview(
        JSON.stringify(
          parsed.map((b) => ({
            kind: b.kind,
            title: b.title,
            options: b.options,
            correct: b.correct,
          })),
          null,
          2,
        ),
      );
      if (parsed.length === 0) {
        setStage("select");
        const msg =
          "تعذر استخراج الأسئلة من الملف.\nتأكد من أن ملف Word يحتوي على أسئلة واضحة ومنظمة ثم حاول مرة أخرى.";
        setError(msg);
        toast.error("تعذر استخراج الأسئلة من الملف.");
        return;
      }
      setBlocks(parsed);
      setSelected(new Set());
      setStage("review");
      setProgressStage("done");
      setAnalyzingMsg(`انتهى الاستخراج — تم العثور على ${parsed.length} سؤالاً.`);
      const need = parsed.filter((b) => reviewReason(b) !== null).length;
      toast.success(
        `تم العثور على ${parsed.length} سؤالاً — راجِعها قبل إضافتها إلى الامتحان.` +
          (need ? ` ⚠ ${need} يحتاج إلى مراجعة` : ""),
      );
    } catch (err) {
      if (!openRef.current) return;
      const msg =
        err instanceof Error
          ? err.message
          : "تعذّر تحليل الملف.\nتأكد من أن ملف Word يحتوي على أسئلة واضحة ومنظمة ثم حاول مرة أخرى.";
      setStage("select");
      setError(msg);
      toast.error(msg);
    }
  }, []);

  /*============================ اختيار الملف ============================*/
  const acceptFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!isSupportedTextFile(f)) {
      const msg = conversionHint(f);
      setError(msg);
      toast.error(msg);
      return;
    }
    setError(null);
    setPendingFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  const startFileImport = () => {
    if (!pendingFile) {
      toast.error("اختر ملف Word أولاً أو أفلته في المنطقة المخصصة.");
      return;
    }
    void analyze(pendingFile);
  };

  const startPasteImport = () => {
    if (!pasteText.trim()) {
      toast.error("الرجاء لصق نص الأسئلة أولاً.");
      return;
    }
    void analyze(pasteText.trim());
  };

  /*============================ تعديل الكتل ============================*/
  const patchBlock = (idx: number, patch: Partial<ParsedBlock>) =>
    setBlocks((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });

  const changeKind = (idx: number, kind: ParsedBlock["kind"]) => {
    setBlocks((prev) => {
      const next = [...prev];
      const b: ParsedBlock = { ...next[idx], kind };
      if (kind === "truefalse") {
        b.options = ["صح", "خطأ"];
        const corr = (b.correct ?? [])
          .map(normTF)
          .filter((w) => w === "صح" || w === "خطأ");
        b.correct = corr.length ? Array.from(new Set(corr)) : undefined;
      } else if (kind === "radio" || kind === "checkbox") {
        const live = b.options.map((o) => o.trim()).filter(Boolean);
        if (live.length < 2) {
          b.options = [
            ...live,
            ...(live.length === 1 ? ["خيار 2"] : ["خيار 1", "خيار 2"]),
          ];
        }
      } else if (kind === "text" && typeof b.text !== "string") {
        b.text = "";
      }
      next[idx] = b;
      return next;
    });
  };

  const updateOption = (bIdx: number, oIdx: number, v: string) => {
    setBlocks((prev) => {
      const next = [...prev];
      const b = next[bIdx];
      const old = b.options[oIdx];
      const options = b.options.map((o, k) => (k === oIdx ? v : o));
      // إبقاء الإجابة الصحيحة مربوطة بالخيار بعد تعديل نصّه
      const correct = b.correct?.map((c) => (c === old ? v : c));
      next[bIdx] = { ...b, options, correct };
      return next;
    });
  };

  const addOption = (bIdx: number) => {
    setBlocks((prev) => {
      const next = [...prev];
      const b = next[bIdx];
      next[bIdx] = {
        ...b,
        options: [...b.options, "خيار " + (b.options.length + 1)],
      };
      return next;
    });
  };

  const removeOption = (bIdx: number, oIdx: number) => {
    setBlocks((prev) => {
      const next = [...prev];
      const b = next[bIdx];
      if (b.options.length <= 2) return prev;
      const removed = b.options[oIdx];
      next[bIdx] = {
        ...b,
        options: b.options.filter((_, k) => k !== oIdx),
        correct: b.correct?.filter((c) => c !== removed),
      };
      return next;
    });
  };

  const toggleCorrect = (bIdx: number, oIdx: number) => {
    setBlocks((prev) => {
      const next = [...prev];
      const b = next[bIdx];
      if (b.kind !== "radio" && b.kind !== "checkbox" && b.kind !== "truefalse") {
        return prev;
      }
      const correct = b.correct ? [...b.correct] : [];
      const opt = b.options[oIdx];
      const at = correct.indexOf(opt);
      if (at >= 0) {
        correct.splice(at, 1);
      } else {
        // الاختيار المنفرد وصح/خطأ يقبلان إجابة واحدة فقط
        if (b.kind !== "checkbox") correct.length = 0;
        correct.push(opt);
      }
      next[bIdx] = { ...b, correct };
      return next;
    });
  };

  const isCorrect = (bIdx: number, oIdx: number): boolean => {
    const b = blocks[bIdx];
    return b.correct ? b.correct.includes(b.options[oIdx]) : false;
  };

  /*============================ التحديد والحذف والترتيب ============================*/
  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  };

  const allSelected = blocks.length > 0 && selected.size === blocks.length;

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(blocks.map((_, i) => i)));

  const deleteBlock = (idx: number) => {
    setBlocks((prev) => prev.filter((_, k) => k !== idx));
    setSelected((prev) => {
      const n = new Set<number>();
      prev.forEach((k) => {
        if (k === idx) return;
        n.add(k > idx ? k - 1 : k);
      });
      return n;
    });
  };

  const deleteSelected = () => {
    if (!selected.size) return;
    const count = selected.size;
    setBlocks((prev) => prev.filter((_, i) => !selected.has(i)));
    setSelected(new Set());
    toast.success(`تم حذف ${count} سؤالاً من المعاينة`);
  };

  const applyBulkPoints = () => {
    const v = Number(bulkPoints);
    const pts = Number.isFinite(v) && v >= 0 ? v : 1;
    const count = selected.size;
    setBlocks((prev) =>
      prev.map((b, i) =>
        selected.has(i) && b.kind !== "text" ? { ...b, points: pts } : b,
      ),
    );
    toast.success(`تم تعيين درجة ${pts} لـ ${count} سؤالاً`);
  };

  const moveSelected = (mode: "top" | "bottom") => {
    if (!selected.size) return;
    setBlocks((prev) => {
      const sel = prev.filter((_, i) => selected.has(i));
      const rest = prev.filter((_, i) => !selected.has(i));
      return mode === "top" ? [...sel, ...rest] : [...rest, ...sel];
    });
    setSelected(new Set());
    toast.success(
      mode === "top" ? "تم نقل المحدد إلى الأعلى" : "تم نقل المحدد إلى الأسفل",
    );
  };

  const moveBlock = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;
    setBlocks((prev) => {
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
    setSelected((prev) => {
      const n = new Set(prev);
      const hadI = n.has(idx);
      const hadJ = n.has(j);
      if (hadI) n.add(j);
      else n.delete(j);
      if (hadJ) n.add(idx);
      else n.delete(idx);
      return n;
    });
  };

  /*============================ الإضافة إلى الامتحان ============================*/
  const handleAddToForm = () => {
    if (blocks.length === 0) {
      toast.error("لا توجد أسئلة للاستيراد.");
      return;
    }
    const questions = blocksToQuestions(blocks, "مستورد من ملف");
    onImport(questions);
    onOpenChange(false);
  };

  const backToSelect = () => {
    setStage("select");
    setBlocks([]);

    setSelected(new Set());
    setShowRaw(false);
    setError(null);
  };

  const stats = useMemo(
    () => ({
      total: blocks.length,
      mcq: blocks.filter((b) => b.kind === "radio" || b.kind === "checkbox").length,
      tf: blocks.filter((b) => b.kind === "truefalse").length,
      essay: blocks.filter(
        (b) => b.kind === "short" || b.kind === "paragraph",
      ).length,
      texts: blocks.filter((b) => b.kind === "text").length,
      review: blocks.filter((b) => reviewReason(b) !== null).length,
    }),
    [blocks],
  );

  if (!open) return null;

  const statChips: Array<[string, number, boolean]> = [
    ["إجمالي", stats.total, false],
    ["اختيار من متعدد", stats.mcq, false],
    ["صح وخطأ", stats.tf, false],
    ["مقالي", stats.essay, false],
    ["نصوص وصفية", stats.texts, false],
    ["يحتاج إلى مراجعة", stats.review, true],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] max-w-4xl h-[92dvh] sm:h-[85dvh] flex flex-col gap-3 overflow-x-hidden overflow-y-auto p-4 sm:p-6 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
        <DialogClose />
        <DialogHeader className="shrink-0 sticky top-0 z-10 bg-background -mx-4 sm:-mx-6 px-4 sm:px-6 py-1">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" aria-hidden />
            {stage === "review"
              ? "مراجعة الأسئلة المستوردة"
              : "استيراد الأسئلة من Word"}
          </DialogTitle>
          <DialogDescription>
            {stage === "review"
              ? "راجع كل سؤال وعدّل عليه قبل إضافته — الأسئلة الجديدة تُضاف إلى نهاية الامتحان دون مساس بما هو موجود."
              : "قم برفع ملف Word يحتوي على أسئلة الامتحان، وسيقوم النظام باستخراج الأسئلة والاختيارات تلقائيًا."}
          </DialogDescription>
        </DialogHeader>

        {/* ============================ اختيار الملف ============================ */}
        {stage === "select" && (
          <div className="flex flex-col gap-3">
            <section
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInput.current?.click();
                }
              }}
              className={cn(
                "cursor-pointer rounded-xl border-2 border-dashed p-6 sm:p-8 text-center transition",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-input bg-surface/50 hover:bg-secondary/50",
              )}
            >
              <FileUp className="mx-auto h-8 w-8 text-primary" aria-hidden />
              <p className="mt-3 text-sm font-bold">
                اسحب ملف Word وأفلته هنا
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                أو اضغط لاختيار ملف من جهازك — الصيغ المدعومة:{" "}
                <b>.docx</b> و <b>.doc</b>
              </p>
            </section>
            <input
              ref={fileInput}
              type="file"
              accept=".docx,.doc,.txt,.md,.pdf"
              className="hidden"
              onChange={(e) => {
                acceptFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />

            {pendingFile && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText
                    className="h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span className="truncate text-sm font-semibold">
                    {pendingFile.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ({formatSize(pendingFile.size)})
                  </span>
                </div>
                <button
                  onClick={() => setPendingFile(null)}
                  className="rounded p-1 text-muted-foreground transition hover:text-destructive"
                  title="إزالة الملف"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <div className="flex gap-2">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden
                  />
                  <span className="whitespace-pre-wrap">{error}</span>
                </div>
              </div>
            )}

            <section className="surface-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ClipboardPaste className="h-4 w-4" aria-hidden />
                لصق وتحليل نص (بديل عن الملف)
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="الصق نص الأسئلة هنا… (يدعم الترقيم العربي A-D وأ، ب، ج، د)"
                rows={3}
                className="mt-2 w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
              <button
                onClick={startPasteImport}
                disabled={!pasteText.trim()}
                className="mt-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold transition hover:bg-secondary disabled:opacity-50"
              >
                حلّل النص الملصوق
              </button>
            </section>
          </div>
        )}

        {/* ============================ التحليل ============================ */}
        {stage === "analyzing" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10">
            <Loader2
              className="h-10 w-10 animate-spin text-primary"
              aria-hidden
            />
            <p className="text-sm font-bold">{analyzingMsg}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {progressStage === "reading"
                ? "שלב 1/3: קריאת הקובץ"
                : progressStage === "extracting"
                  ? "שלב 2/3: חילוץ פסקאות"
                  : progressStage === "parsing"
                    ? "שלב 3/3: זיהוי שאלות"
                    : "הושלם"}
            </p>
            {pendingFile && (
              <p className="max-w-full truncate text-xs text-muted-foreground">
                {pendingFile.name} ({formatSize(pendingFile.size)})
              </p>
            )}
            <div className="w-56 overflow-hidden rounded-full bg-secondary border">
              <div
                className="h-2 rounded-full bg-primary transition-all duration-300"
                style={{
                  width:
                    progressStage === "reading"
                      ? "25%"
                      : progressStage === "extracting"
                        ? "60%"
                        : progressStage === "parsing"
                          ? "90%"
                          : "100%",
                }}
              />
            </div>
            {questionsFound > 0 && (
              <p className="text-xs text-muted-foreground">
                זוהתה עד כה: {questionsFound} שאלה
              </p>
            )}
          </div>
        )}

        {/* ============================ شاشة المراجعة ============================ */}
        {stage === "review" && (
          <div className="flex flex-col gap-3">
            {/* الإحصائيات */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {statChips.map(([label, value, warn]) => (
                <div
                  key={label}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-center",
                    warn && value > 0
                      ? "border-amber-500/50 bg-amber-500/10"
                      : "border-border bg-surface",
                  )}
                >
                  <div
                    className={cn(
                      "text-lg font-black leading-tight",
                      warn && value > 0 ? "text-amber-600" : "text-foreground",
                    )}
                  >
                    {value}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            {stats.review > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden
                />
                <span>
                  {stats.review} سؤالاً يحتاج إلى مراجعة — راجع الإجابة الصحيحة
                  أو نص السؤال قبل الإضافة إلى الامتحان.
                </span>
              </div>
            )}

            {/* شريط الأدوات الجماعية */}
            <div className="surface-card flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-xs">
              <label className="flex cursor-pointer items-center gap-1.5 font-semibold">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4"
                />
                تحديد الكل
              </label>
              <span className="text-muted-foreground">
                ({selected.size} محدد)
              </span>
              <div className="grow" />
              <button
                onClick={deleteSelected}
                disabled={!selected.size}
                className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-2.5 py-1.5 font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> حذف المحدد
              </button>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">الدرجة:</span>
                <input
                  type="number"
                  min={0}
                  value={bulkPoints}
                  onChange={(e) => setBulkPoints(e.target.value)}
                  className="w-14 rounded border border-input bg-background px-1.5 py-1 text-center outline-none focus:border-ring"
                  aria-label="الدرجة المطلوبة تطبيقها"
                />
                <button
                  onClick={applyBulkPoints}
                  disabled={!selected.size}
                  className="rounded-lg border border-border px-2.5 py-1.5 font-semibold transition hover:bg-secondary disabled:opacity-40"
                >
                  تغيير الدرجات
                </button>
              </div>
              <button
                onClick={() => moveSelected("top")}
                disabled={!selected.size}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-semibold transition hover:bg-secondary disabled:opacity-40"
                title="نقل المحدد إلى الأعلى"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden /> إعادة ترتيب
                (لأعلى)
              </button>
              <button
                onClick={() => moveSelected("bottom")}
                disabled={!selected.size}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-semibold transition hover:bg-secondary disabled:opacity-40"
                title="نقل المحدد إلى الأسفل"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden /> (لأسفل)
              </button>
            </div>


            {/* معاينة النص المستخرج */}
            {rawText && (
              <div className="rounded-xl border border-border bg-surface/50">
                <button
                  onClick={() => setShowRaw((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                  {showRaw ? "إخفاء" : "عرض"} النص المستخرج من الملف
                </button>
                {showRaw && (
                  <textarea
                    value={rawText}
                    readOnly
                    rows={8}
                    className="w-full max-w-full overflow-x-auto border-t border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none"
                  />
                )}
                {/* وضع التصحيح: text خام / after تنظيف / نتيجة المُحلّل */}
                <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    وضع التصحيح (Debug)
                  </span>
                  <button
                    onClick={() => {
                      if (!debugMode) {
                        setDebugMode(true);
                        setDebugView("raw");
                      } else {
                        setDebugMode(false);
                      }
                    }}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition",
                      debugMode
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface hover:bg-secondary",
                    )}
                  >
                    {debugMode ? "إخفاء" : "عرض"} Debug
                  </button>
                </div>
                {debugMode && (
                  <div className="border-t border-border">
                    <div className="flex gap-1 px-3 py-2">
                      {(["raw", "cleaned", "parsed"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setDebugView(v)}
                          className={cn(
                            "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                            debugView === v
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary/60 hover:bg-secondary",
                          )}
                        >
                          {v === "raw"
                            ? "نص أصلي"
                            : v === "cleaned"
                              ? "بعد التنظيف"
                              : "نتيجة Parser"}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={
                        debugView === "raw"
                          ? rawText
                          : debugView === "cleaned"
                            ? rawText
                            : parsedPreview || "(لا توجد بيانات)"
                      }
                      readOnly
                      rows={10}
                      className="w-full max-w-full overflow-x-auto border-t border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none"
                    />
                  </div>
                )}
              </div>
            )}

            {/* قائمة الأسئلة */}
            <div className="space-y-3">
              {sections.map((section, sIdx) => (
              <div key={section.id} className="rounded-xl border-2 border-primary/30 bg-surface/20 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">
                    قسم {sIdx + 1}
                  </span>
                  <input
                    value={section.title}
                    onChange={(e) => {
                      const firstIdx = sections
                        .slice(0, sIdx)
                        .reduce((a, s) => a + s.blocks.length, 0);
                      patchBlock(firstIdx, { title: e.target.value });
                    }}
                    className="grow rounded border border-input bg-background px-2 py-1 text-sm font-bold outline-none focus:border-ring"
                    placeholder="عنوان القسم"
                  />
                </div>
                {section.blocks.map((b, bIdx) => {
                  const idx = sections.slice(0, sIdx).reduce((a, s) => a + s.blocks.length, 0) + bIdx;

                const reason = reviewReason(b);
                const isSel = selected.has(idx);
                const answerable =
                  b.kind === "radio" ||
                  b.kind === "checkbox" ||
                  b.kind === "truefalse";
                return (
                  <div
                    key={idx}
                    className={cn(
                      "rounded-lg border bg-surface/30 p-3",
                      isSel
                        ? "border-primary/60 ring-1 ring-primary/30"
                        : "border-border",
                    )}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleSelect(idx)}
                        className="h-4 w-4"
                        aria-label={`تحديد السؤال ${idx + 1}`}
                      />
                      <span className="text-xs font-black text-muted-foreground">
                        #{idx + 1}
                      </span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold">
                        {kindLabel(b.kind)}
                      </span>
                      {reason && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-600"
                          title={reason}
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          يحتاج إلى مراجعة: {reason}
                        </span>
                      )}
                      <div className="grow" />
                      {b.kind !== "text" && (
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          الدرجة
                          <PointsInput
                            value={b.points ?? 1}
                            onCommit={(v) => patchBlock(idx, { points: v })}
                          />
                        </label>
                      )}
                      <button
                        onClick={() => moveBlock(idx, -1)}
                        disabled={idx === 0}
                        className="rounded p-1 text-muted-foreground transition hover:bg-secondary disabled:opacity-30"
                        title="تحريك لأعلى"
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        onClick={() => moveBlock(idx, 1)}
                        disabled={idx === blocks.length - 1}
                        className="rounded p-1 text-muted-foreground transition hover:bg-secondary disabled:opacity-30"
                        title="تحريك لأسفل"
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        onClick={() => deleteBlock(idx)}
                        className="rounded p-1.5 text-destructive transition hover:bg-destructive/10"
                        title="حذف السؤال"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>

                    <input
                      value={b.title}
                      onChange={(e) => patchBlock(idx, { title: e.target.value })}
                      className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
                      placeholder={
                        b.kind === "text"
                          ? "عنوان المقروءة (اختياري)"
                          : "نص السؤال…"
                      }
                    />

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        النوع:
                      </span>
                      <select
                        value={b.kind}
                        onChange={(e) =>
                          changeKind(idx, e.target.value as ParsedBlock["kind"])
                        }
                        className="rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                      >
                        {typeOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {answerable && (
                      <div className="mt-2 space-y-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">
                          الاختيارات
                          {b.kind !== "truefalse" &&
                            " — اضغط الدائرة بجانب الخيار لتحديد الإجابة الصحيحة"}
                        </span>
                        <div className="space-y-1.5">
                          {b.options.map((opt, oIdx) => (
                            <div
                              key={oIdx}
                              className="flex items-center gap-2 rounded border border-input/50 bg-background p-2"
                            >
                              <button
                                type="button"
                                onClick={() => toggleCorrect(idx, oIdx)}
                                className={cn(
                                  "rounded-full border p-1 transition",
                                  isCorrect(idx, oIdx)
                                    ? "border-primary bg-primary text-white"
                                    : "border-input text-muted-foreground hover:border-primary/50",
                                )}
                                title={
                                  isCorrect(idx, oIdx)
                                    ? "إزالة التحديد كإجابة صحيحة"
                                    : "تحديد كإجابة صحيحة"
                                }
                                aria-pressed={isCorrect(idx, oIdx)}
                              >
                                {isCorrect(idx, oIdx) ? (
                                  <CheckCircle2
                                    className="h-3 w-3 fill-current"
                                    aria-hidden
                                  />
                                ) : null}
                              </button>
                              <input
                                value={opt}
                                onChange={(e) =>
                                  updateOption(idx, oIdx, e.target.value)
                                }
                                className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
                                placeholder="خيار…"
                              />
                              <button
                                onClick={() => removeOption(idx, oIdx)}
                                disabled={b.options.length <= 2}
                                className="rounded p-1 text-muted-foreground transition hover:text-destructive disabled:opacity-40"
                                title="احذف الخيار"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden />
                              </button>
                            </div>
                          ))}
                          {b.kind !== "truefalse" && (
                            <button
                              onClick={() => addOption(idx)}
                              className="px-2 py-1 text-xs text-primary underline underline-offset-4 hover:text-primary/80"
                            >
                              + إضافة خيار
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {b.kind === "text" && (
                      <div className="mt-2 space-y-1">
                        <span className="text-xs font-semibold text-muted-foreground">
                          نص المقروءة (يُعرض كنص وصفي بدون إجابة)
                        </span>
                        <textarea
                          value={b.text ?? ""}
                          onChange={(e) =>
                            patchBlock(idx, { text: e.target.value })
                          }
                          rows={4}
                          className="w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-sm leading-relaxed outline-none focus:border-ring"
                          placeholder="نص الفقرة التمهيدية…"
                        />
                      </div>
                    )}

                    {(b.kind === "short" || b.kind === "paragraph") && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        سؤال مقالي — تُكتب الإجابة نصاً من الطالب.
                        {b.correct && b.correct.length > 0 && (
                          <span className="text-green-700">
                            {" "}
                            مفتاح الإجابة المقترح: <b>{b.correct.join("، ")}</b>
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
                </div>
              ))}
            </div>

            {blocks.length === 0 && (
              <div className="rounded-xl border border-dashed border-input bg-surface/50 p-4 text-center text-sm text-muted-foreground">
                <AlertTriangle className="mx-auto mb-2 h-4 w-4" aria-hidden />
                لا توجد أسئلة في المعاينة — عُد واختر ملفاً آخر.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="shrink-0 sticky bottom-0 z-10 -mx-4 -mb-4 border-t border-border/50 bg-background px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {stage === "review" ? (
              <>
                <Button
                  variant="outline"
                  onClick={backToSelect}
                  className="w-full sm:w-auto"
                >
                  رجوع لاختيار ملف آخر
                </Button>
                <Button
                  onClick={handleAddToForm}
                  disabled={blocks.length === 0}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  إضافة الأسئلة إلى الامتحان ({blocks.length})
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={stage === "analyzing"}
                  className="w-full sm:w-auto"
                >
                  إلغاء
                </Button>
                <Button
                  onClick={startFileImport}
                  disabled={!pendingFile || stage === "analyzing"}
                  className="w-full sm:w-auto"
                >
                  <Upload className="h-4 w-4" aria-hidden />
                  بدء الاستيراد
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
