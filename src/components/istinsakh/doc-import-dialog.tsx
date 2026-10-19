"use client";

import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Button,
} from "@/components/ui/button";
import {
  Upload,
  FileText,
  FileUp,
  Trash2,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  LayoutList,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import type { Question } from "@/lib/form-types";
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

export function DocImportDialog({
  open,
  onOpenChange,
  onImport,
}: DocImportDialogProps) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rawExtractedText, setRawExtractedText] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [blocks, setBlocks] = useState<ParsedBlock[]>([]);
  const [parsing, setParsing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const parseNow = useCallback(
    async (source: string | File) => {
      setParsing(true);
      try {
        let raw: string;
        if (typeof source === "string") {
          raw = source;
        } else {
          if (!isSupportedTextFile(source)) {
            toast.error(conversionHint(source));
            setParsing(false);
            return;
          }
          if (source.name.toLowerCase().endsWith(".pdf")) {
            setPdfLoading(true);
          }
          raw = await readFileContent(source);
          setFile(source);
          setRawExtractedText(raw);
        }
        const parsed = parseDocText(raw);
        setBlocks(parsed);
        setText(typeof source === "string" ? source : text);
        if (parsed.length === 0) {
          toast.warning("لم يتم العثور على أسئلة قابلة للتحليل في النص.");
        } else {
          toast.success(`تم استخراج ${parsed.length} سؤالاً — راجِعها في المعاينة أدناه.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "تعذّر تحليل الملف.";
        toast.error(msg);
        console.error(err);
      } finally {
        setParsing(false);
        setPdfLoading(false);
      }
    },
    [],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseNow(f);
    e.target.value = "";
  };

  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const handlePasteImport = () => {
    if (!text.trim()) {
      toast.error("الرجاء لصق نص الأسئلة أولاً.");
      return;
    }
    parseNow(text);
  };

  const updateBlockTitle = (idx: number, v: string) => {
    setBlocks((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], title: v };
      return next;
    });
  };

  const updateBlockType = (idx: number, kind: ParsedBlock["kind"]) => {
    setBlocks((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], kind };
      return next;
    });
  };

  const updateBlockOption = (bIdx: number, oIdx: number, v: string) => {
    setBlocks((prev) => {
      const next = [...prev];
      next[bIdx] = {
        ...next[bIdx],
        options: next[bIdx].options.map((o, k) => (k === oIdx ? v : o)),
      };
      return next;
    });
  };

  const addOption = (bIdx: number) => {
    setBlocks((prev) => {
      const next = [...prev];
      next[bIdx] = {
        ...next[bIdx],
        options: [...next[bIdx].options, "خيار جديد"],
      };
      return next;
    });
  };

  const removeOption = (bIdx: number, oIdx: number) => {
    setBlocks((prev) => {
      const next = [...prev];
      next[bIdx] = {
        ...next[bIdx],
        options: next[bIdx].options.filter((_, k) => k !== oIdx),
      };
      return next;
    });
  };

  const removeBlock = (idx: number) => {
    setBlocks((prev) => prev.filter((_, k) => k !== idx));
  };

  const toggleCorrect = (bIdx: number, oIdx: number) => {
    setBlocks((prev) => {
      const next = [...prev];
      const b = next[bIdx];
      if (b.kind !== "radio" && b.kind !== "checkbox") return next;
      const correct = b.correct ? [...b.correct] : [];
      const opt = b.options[oIdx];
      if (correct.includes(opt)) {
        correct.splice(correct.indexOf(opt), 1);
      } else {
        correct.push(opt);
      }
      next[bIdx] = { ...b, correct };
      return next;
    });
  };

  const isCorrect = (bIdx: number, oIdx: number) => {
    const b = blocks[bIdx];
    return b.correct ? b.correct.includes(b.options[oIdx]) : false;
  };

  const handleImport = () => {
    if (blocks.length === 0) {
      toast.error("لا توجد أسئلة للاستيراد.");
      return;
    }
    const questions = blocksToQuestions(blocks, "مستورد من ملف");
    onImport(questions);
    onOpenChange(false);
    // إعادة التعيين
    setBlocks([]);
    setText("");
    setFile(null);
  };

  if (!open) return null;

  const typeOptions: Array<{ value: ParsedBlock["kind"]; label: string }> = [
    { value: "radio", label: "اختيار من متعدد (واحد)" },
    { value: "checkbox", label: "اختيار من متعدد (عدة)" },
    { value: "short", label: "إجابة قصيرة" },
    { value: "paragraph", label: "فقرة نصية" },
    { value: "text", label: "نص وصفي (بدون إجابة)" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] max-w-4xl h-[92dvh] sm:h-[85dvh] flex flex-col gap-0 overflow-hidden p-4 sm:p-6">
        <DialogClose />
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" aria-hidden />
            استيراد أسئلة من ملف / نص
          </DialogTitle>
          <DialogDescription>
            استخرج الأسئلة والاختيارات من ملف نصي (.txt) أو PDF أو وورد (.docx)،
            أو الصق النص مباشرة. راجع كل سؤال وعدّل عليه قبل الاستيراد إلى نموذجك.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-1 sm:pr-2">
          {/* مصدر الاستيراد */}
          <section className="surface-card p-4 rounded-xl border border-border">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Upload className="h-4 w-4" aria-hidden />
                ملف نصي / PDF / وورد (.docx)
              </div>
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <button
                  onClick={() => fileInput.current?.click()}
                  className="rounded-xl border border-dashed border-input bg-surface px-4 py-3 text-sm hover:bg-secondary transition"
                >
                  <FileUp className="h-4 w-4 mr-2" aria-hidden />
                                اختر ملف
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".txt,.md,.pdf,.docx"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {file && (
                  <span className="text-xs text-muted-foreground">
                    {file.name} ({Math.round(file.size / 1024)} ك.ب)
                    {pdfLoading &&
                      file.name.toLowerCase().endsWith(".pdf") && (
                        <span className="ml-2 animate-pulse text-xs text-primary">
                          (جارٍ استخراج النص من PDF…)
                        </span>
                      )}
                  </span>
                )}
              </div>

              <div className="h-1 w-full"></div>

              <div className="flex items-center gap-2 text-sm font-semibold">
                <RotateCcw className="h-4 w-4" aria-hidden />
                نسخ ولصق نص
              </div>
              <textarea
                value={text}
                onChange={handlePasteChange}
                placeholder="الصق نص الأسئلة هنا… (كل سطر فارغ يبدأ سؤالاً جديداً)"
                rows={4}
                className="rounded-xl border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 w-full"
              />
              <button
                onClick={handlePasteImport}
                disabled={parsing || !text.trim()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50 transition hover:opacity-90"
              >
                {parsing ? "جارٍ التحليل…" : "حلّل النص الصق"}
              </button>
            </div>
          </section>

          {/* معاينة النص المستخرج من الملف */}
          {rawExtractedText && (
            <section className="surface-card p-0 rounded-xl border border-border overflow-hidden mb-3">
              <div className="p-4 border-b border-border flex items-center justify-between bg-surface/50">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="font-semibold">معاينة النص المستخرج من الملف</span>
                </div>
                <div className="flex items-center gap-1">
                  {file && (
                    <span className="text-xs text-muted-foreground">
                      {file.name} ({Math.round(file.size / 1024)} ك.ب)
                    </span>
                  )}
                  <button
                    onClick={() => setPreviewOpen(true)}
                    className="rounded border border-input bg-surface px-2 py-1.5 text-xs hover:bg-secondary transition"
                    title="افتح معاينة كاملة"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="p-4">
                <textarea
                  value={rawExtractedText}
                  readOnly
                  rows={6}
                  className="rounded-xl border border-input bg-surface px-3 py-2 text-sm outline-none w-full font-mono text-sm"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  هذا النص المستخرج مباشرة من الملف. يتم تقسيمه تلقائياً إلى أسئلة أدناه — يمكنك تعديل كل سؤال قبل الاستيراد.
                </p>
              </div>
            </section>
          )}

          {/* معاينة الأسئلة */}
          {blocks.length > 0 && (
            <section className="surface-card p-0 rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between bg-surface/50">
                <div className="flex items-center gap-2">
                  <LayoutList className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="font-semibold">
                    الأسئلة المستخرجة ({blocks.length})
                  </span>
                </div>
                <button
                  onClick={handleImport}
                  disabled={parsing}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50 transition hover:opacity-90"
                >
                  {parsing ? "جارٍ الاستيراد…" : "استورد الأسئلة إلى النموذج"}
                </button>
              </div>

              <div className="p-4 space-y-3">
                {blocks.map((b, idx) => (
                  <div
                    key={b.title + idx}
                    className="rounded-lg border border-border p-3 bg-surface/30"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <label className="block text-xs font-semibold text-muted-foreground mb-1">
                          سؤال #{idx + 1}
                        </label>
                        <input
                          value={b.title}
                          onChange={(e) => updateBlockTitle(idx, e.target.value)}
                          className="rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring w-full"
                          placeholder="نص السؤال…"
                        />
                      </div>
                      <select
                        value={b.kind}
                        onChange={(e) =>
                          updateBlockType(idx, e.target.value as ParsedBlock["kind"])
                        }
                        className="rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                      >
                        {typeOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeBlock(idx)}
                        className="rounded p-1.5 text-destructive hover:bg-destructive/10 transition"
                        title="احذف السؤال"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>

                    {b.kind === "radio" || b.kind === "checkbox" ? (
                      <div className="space-y-2 mt-2">
                        <label className="text-xs font-semibold text-muted-foreground">
                          الخيرات
                        </label>
                        <div className="space-y-1.5">
                          {b.options.map((opt, oIdx) => (
                            <div
                              key={oIdx}
                              className="flex items-center gap-2 bg-background p-2 rounded border border-input/50"
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
                                title={isCorrect(idx, oIdx) ? "إزالة التحديد كإجابة صحيحة" : "تحديد كإجابة صحيحة"}
                                aria-pressed={isCorrect(idx, oIdx)}
                              >
                                {isCorrect(idx, oIdx) ? (
                                  <CheckCircle2 className="h-3 w-3 fill-current" aria-hidden />
                                ) : null}
                              </button>
                              <input
                                value={opt}
                                onChange={(e) => updateBlockOption(idx, oIdx, e.target.value)}
                                className="flex-1 bg-transparent border-none outline-none text-sm min-w-0"
                                placeholder="خيار…"
                              />
                              <button
                                onClick={() => removeOption(idx, oIdx)}
                                disabled={b.options.length <= 2}
                                className="rounded p-1 text-muted-foreground hover:text-destructive transition disabled:opacity-40"
                                title="احذف الخيار"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => addOption(idx)}
                            className="text-xs text-primary hover:text-primary/80 underline underline-offset-4 px-2 py-1"
                          >
                            + إضافة خيار
                          </button>
                        </div>
                      </div>
                    ) : (
                      b.correct && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-green-700 bg-green-50/50 rounded px-2 py-1">
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          <span>مفتاح الإجابة المقترح: <b>{b.correct.join("، ")}</b></span>
                        </div>
                      )
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!blocks.length && text.trim() && !file ? (
            <div className="p-4 rounded-xl border border-dashed border-input bg-surface/50 text-center text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 mx-auto mb-2" aria-hidden />
              لم يتم استخراج أسئلة بعد. اضغط "حلّل النص الصق" أعلاه.
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 pt-3 border-t border-border/50 mt-1">
          <div className="flex flex-col-reverse sm:flex-row w-full gap-2 sm:gap-2 sm:justify-end">
            <Button onClick={() => onOpenChange(false)} variant="outline" className="w-full sm:w-auto">
              إلغاء
            </Button>
            <Button
              onClick={handleImport}
              disabled={blocks.length === 0 || parsing}
              className="w-full sm:w-auto"
            >
              {parsing ? "جاري…" : "تأكيد واستيراد إلى النموذج"}
            </Button>
          </div>
        </DialogFooter>
        {/* نافذة معاينة كاملة للنص المستخرج */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] max-w-2xl h-[90dvh] sm:h-[80dvh] p-4 sm:p-6 flex flex-col gap-0 overflow-hidden">
            <DialogClose />
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-primary" aria-hidden />
                معاينة النص المستخرج
              </DialogTitle>
              <DialogDescription>
                {file ? (
                  <span className="text-sm text-muted-foreground">
                    {file.name} ({Math.round(file.size / 1024)} ك.ب)
                  </span>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex-1 overflow-auto bg-surface p-4 rounded-xl border border-border font-mono text-sm leading-relaxed max-h-[60vh]">
              {rawExtractedText}
            </div>
            <DialogFooter className="mt-4">
              <Button onClick={() => setPreviewOpen(false)} className="ml-auto">
                إغلاق
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </DialogContent>
    </Dialog>
  );
}

