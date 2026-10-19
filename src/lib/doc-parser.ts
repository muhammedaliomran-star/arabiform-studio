import type { Question } from "@/lib/form-types";
import { newQuestion, uid } from "@/lib/form-types";

/** نتيجة تحليل كتلة نصية واحدة قبل العرض في شاشة المعاينة */
export type ParsedBlock = {
  /** نوع السؤال المقترح (يعدلها المستخدم في المعاينة) */
  kind: "radio" | "checkbox" | "short" | "paragraph" | "text";
  /** نص السؤال (يعدل) */
  title: string;
  /** الخيرات المقترحة (يعدل/يحذف/يزيد) */
  options: string[];
  /** الإجابة الصحيحة المقترحة إن وجدت (يترك فارغاً لو غير متأكد) */
  correct?: string[];
  /** هل السؤال مطلوب */
  required: boolean;
};

/** إزالة التشكيل والمسافات الزائدة والطول الزائد (tatweel) */
function normalizeArabic(s: string): string {
  return s
    .replace(/\u0640/g, "") // tatweel
    .replace(/[\u064B-\u0652\u0610-\u061A]/g, "") // harakat / diacritics
    .replace(/\s+/g, " ")
    .trim();
}

/** سطر طويل يُحتمل أنه سؤال (يحتوي على علامات استفهام أو استفهام ضمني) */
function isLikelyQuestion(s: string): boolean {
  const t = normalizeArabic(s);
  if (/[؟?]$/.test(t)) return true;
  // starter words typical of Arabic questions
  const starters = [
    "ما", "كيف", "لماذا", "متى", "أين", "من", "كم", "أي", "أيّ", "هل",
    "أكمل", "ضع", "الصواب", "العلاقة", "العنوان",
    "الفائدة", "المعنى", "الضمير", "أسلوب", "تتمثل", "يُقصد",
  ];
  for (const st of starters) {
    if (t.startsWith(st + " ") || t === st) return true;
  }
  return false;
}

/** هل السطر قصير بما يكفي ليكون خياراً (اختيار من متعدد) */
function isShortOption(s: string): boolean {
  const t = normalizeArabic(s);
  if (t.length === 0) return false;
  if (t.length > 60) return false;
  // رقم خالص فقط
  if (/^[٠-٩0-9]+$/.test(t)) return true;
  // لا يحتوي على علامات استفهام ولا نقطتين من نوع الشبيه
  if (/[؟?:]/.test(t)) return false;
  return true;
}

/** زوج شبيه: "كلمة : معنى" */
const ANALOGY_RE = /^(.{2,40}?)\s*[:：]\s*(.{2,40}?)\s*$/;

/** سطر مرقّم: "1)" "١." "أ)" الخ */
const NUMBERED_RE = /^([٠-٩0-9]{1,2}[\)\.]|\u0627|ب|ج|د|هـ|و|ز|ح|ط|ي|ك|ل|م|ن|س|ع|ف|ص|ق|ر|ش|ت|ث|خ|ذ|ض|ظ|غ|ف|c[\)\.])\s+/;

/** تحليل النص المستخرج من ملف وورد/بي دي إف/لصق */
export function parseDocText(raw: string): ParsedBlock[] {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u000B/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const blocks: ParsedBlock[] = [];
  let i = 0;
  const n = lines.length;
  let questionNumber = 0;

  const hasHL = (s: string) => s.includes("[[HL]]");
  const stripHL = (s: string) =>
    s.replace(/\[\[HL\]\]/g, "").replace(/\[\[\/HL\]\]/g, "").trim();

  // strip option prefix like: "A) ", "1. ", "Ø£) " etc.
  const stripOptionPrefix = (s: string): string =>
    s.replace(/^([\u0621-\u064A]{1,3}|[A-Za-z]{1,2}|\d{1,2})[\)\.\uFF1A:]\s*/i, "").trim();

  while (i < n) {
    const cur = lines[i];
    const curClean = stripHL(cur);
    if (!curClean) { i++; continue; }

    // detect numbered question: "1. text" or "2) text" or Arabic-Indic "1. text"
    const numberedQ =
      curClean.match(/^(\d+)[\)\.]\s*(.+)/) ||
      curClean.match(/^[\u0660-\u0669]{1,2}[\)\.]\s*(.+)/);
    const isQuestionMark = /[\u061F?]/.test(curClean);

    if (numberedQ || (isQuestionMark && curClean.length > 10)) {
      questionNumber++;
      const rawTitle = numberedQ ? numberedQ[2].trim() : curClean;
      const title = questionNumber + ". " + rawTitle;
      const options: string[] = [];
      const correctAnswer: string[] = [];

      // collect following short lines as options
      let j = i + 1;
      while (j < n) {
        const optClean = stripHL(lines[j]);
        if (!optClean) { j++; continue; }

        // detect if this is a new numbered question (stop collecting options)
        const isNextQ = optClean.match(/^(\d+)[\)\.]\s*(.+)/);
        const isShort = optClean.length <= 100 && !/[\u061F?]/.test(optClean);

        if (isShort && !isNextQ) {
          // strip any existing option prefix like "A) " or "1. "
          const optText = stripOptionPrefix(optClean);
          if (optText.length > 0) {
            options.push(optText);
            if (hasHL(lines[j])) {
              correctAnswer.push(optText);
            }
          }
          j++;
        } else {
          break;
        }
      }

      // always use radio type for questions with 2+ options
      const kind = options.length >= 2 ? "radio" : "short";

      blocks.push({
        kind: kind,
        title: title,
        options: options,
        correct: correctAnswer.length > 0 ? correctAnswer : undefined,
        required: true,
      });
      i = j;
      continue;
    }

    // analogy pattern: "word: meaning"
    const analogy = curClean.match(/^(\S{2,50})\s*[:\uFF1A]\s*(\S{2,50})$/);
    if (analogy && !numberedQ) {
      questionNumber++;
      blocks.push({
        kind: "short",
        title: questionNumber + ". \u0623\u0643\u0645\u0644 \u0627\u0644\u0639\u0644\u0627\u0642\u0629: " + analogy[1] + " : \u061F",
        options: [],
        correct: [analogy[2]],
        required: true,
      });
      i++;
      continue;
    }

    // standalone line - treat as short answer
    questionNumber++;
    blocks.push({
      kind: "short",
      title: questionNumber + ". " + curClean,
      options: [],
      required: true,
    });
    i++;
  }

  return blocks;
}



/** تحويل كتل المحلّل إلى أسئلة من النوع المستخدم في التطبيق */
export function blocksToQuestions(
  blocks: ParsedBlock[],
  formTitle: string,
): Question[] {
  return blocks.map((b, idx) => {
    const q = newQuestion(
      b.kind === "radio"
        ? "radio"
        : b.kind === "checkbox"
          ? "checkbox"
          : b.kind === "paragraph"
            ? "paragraph"
            : "short",
    );
    q.id = uid();
    q.title = b.title || `سؤال ${idx + 1}`;
    q.description = "";
    q.required = b.required;
    q.options = b.options.filter((o) => o.length > 0);
    q.correct = b.correct ?? [];
    return q;
  });
}
