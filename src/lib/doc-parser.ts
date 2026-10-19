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
  const n = lines.length;

  const hasHL = (s: string) => s.includes("[[HL]]");
  const stripHL = (s: string) =>
    s.replace(/\[\[HL\]\]/g, "").replace(/\[\[\/HL\]\]/g, "").trim();

  // strip source numbering prefixes from titles
  const stripSourceNumber = (s: string): string => {
    let t = s;
    // Latin letter + dot/dash + digits: "V.1 ", "VI.2 "
    t = t.replace(/^[A-Za-z]{1,4}[\.\-]\d{1,3}[\)\.\-\:]\s*/i, "");
    // Arabic letter + dot + digits: "A.3 " "A.4 " (alef-dot-digit)
    t = t.replace(/^[\u0621-\u064A]{1,3}\.\s*[\u0660-\u0669]{1,3}[\)\.\-\uFF1D]\s*/, "");
    // Arabic-Indic digits: "9. " "9) " "9- "
    t = t.replace(/^[\u0660-\u0669]{1,3}[\)\.\-\uFF1D]\s*/, "");
    // Regular digits: "9. " "9) " "9- "
    t = t.replace(/^\d{1,3}[\)\.\-\uFF1D]\s*/, "");
    // Arabic letter alone with dot: "A. " (alef-dot-space)
    t = t.replace(/^[\u0621-\u064A]{1,3}\.\s+/, "");
    return t.trim();
  };

  // detect option lines
  const isOptionLine = (s: string): boolean => {
    if (s.length > 100) return false;
    if (/[?]\s*$/.test(s) || /[\u061F]\s*$/.test(s)) return false;
    // Arabic-Indic digits prefix: "1- " etc.
    if (/^[\u0660-\u0669]{1,2}[\-\.\uFF1D\)]\s*/.test(s)) return true;
    // Regular digits prefix: "1- " etc.
    if (/^\d{1,2}[\-\.\uFF1D\)]\s*/.test(s)) return true;
    // Arabic letter prefix: "A) " etc.
    if (/^[\u0623\u0628\u062C\u062F\u0647\u0648\u0632\u062D\u0637\u064A\u0643\u0644\u0645\u0646\u0633\u0639\u0641\u0635\u0642\u0631\u0634\u062A\u062B\u062E\u0630\u0636\u0638\u063A]{1,2}[\)\.\uFF1A:]\s*/.test(s)) return true;
    // English letter prefix: "A) " etc.
    if (/^[A-Za-z]{1,2}[\)\.\uFF1A:]\s*/.test(s)) return true;
    // analogy format: "word : word" (like "honey: trade")
    if (/^.{2,40}\s*[\:\uFF1A]\s*.{2,40}$/.test(s)) return true;
    return false;
  };

  // extract option text (strip prefix)
  const extractOptionText = (s: string): string => {
    return s.replace(/^([\u0660-\u0669]{1,2}|\d{1,2}|[\u0621-\u064A]{1,3}|[A-Za-z]{1,2})[\-\.\)\uFF1D\uFF1A:]\s*/i, "").trim();
  };

  let i = 0;
  let questionNumber = 0;

  while (i < n) {
    const cur = lines[i];
    const curClean = stripHL(cur);
    if (!curClean) { i++; continue; }

    // skip orphaned option lines
    if (isOptionLine(curClean)) {
      i++;
      continue;
    }

    // strip source numbering from the question title
    const cleanTitle = stripSourceNumber(curClean);

    // look ahead for options following this line
    const options: string[] = [];
    const correctAnswer: string[] = [];
    let j = i + 1;

    while (j < n) {
      const optRaw = lines[j];
      const optClean = stripHL(optRaw);
      if (!optClean) { j++; continue; }

      if (isOptionLine(optClean)) {
        const optText = extractOptionText(optClean);
        if (optText.length > 0 && optText.length <= 100) {
          options.push(optText);
          if (hasHL(optRaw)) {
            correctAnswer.push(optText);
          }
        }
        j++;
      } else {
        break;
      }
    }

    // if 2+ options found, this is a multiple choice question
    if (options.length >= 2) {
      questionNumber++;

      blocks.push({
        kind: "radio",
        title: questionNumber + ". " + cleanTitle,
        options: options,
        correct: correctAnswer.length > 0 ? correctAnswer : undefined,
        required: true,
      });
      i = j;
      continue;
    }

    // no options found - skip short section headers without question marks
    if (cleanTitle.length < 30 && !/[\u061F?]/.test(cleanTitle)) {
      i++;
      continue;
    }

    // treat as short answer question with sequential number
    questionNumber++;
    blocks.push({
      kind: "short",
      title: questionNumber + ". " + cleanTitle,
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
