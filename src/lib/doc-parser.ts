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
    .replace(/\u0640/g, "") // tatweel: "هـ" → "ه" لتوحيد بادئات الخيارات
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const blocks: ParsedBlock[] = [];
  const n = lines.length;

  const hasHL = (s: string) => s.includes("[[HL]]");
  const stripHL = (s: string) =>
    s.replace(/\[\[HL\]\]/g, "").replace(/\[\[\/HL\]\]/g, "").trim();

  // strip source numbering prefixes from question titles
  const stripSourceNumber = (s: string): string => {
    let t = s;
    // "V.1 " "VI.2 " "V.1: " (Latin letter + dot + digits + sep/space)
    t = t.replace(/^[A-Za-z]{1,4}[\.\-]\d{1,3}[\)\.\-\:\s]\s*/i, "");
    // Arabic letter + dot/dash + Arabic-Indic digits: "A.3 " "A.٣ "
    t = t.replace(/^[\u0621-\u064A]{1,3}[\.\-]\s*[\u0660-\u0669]{1,3}[\)\.\-\uFF1D\s]\s*/, "");
    // Arabic-Indic digits + dot: "1. "
    t = t.replace(/^[\u0660-\u0669]{1,3}[\.\uFF1E\u066B\u06D4]\s*/, "");
    // Regular digits + dot: "1. "
    t = t.replace(/^\d{1,3}[\.\uFF1E]\s*/, "");
    // Arabic-Indic digits + space: "1 " (question numbering like "2 text")
    t = t.replace(/^[\u0660-\u0669]{1,3}\s+/, "");
    // Regular digits + space: "1 "
    t = t.replace(/^\d{1,3}\s+/, "");
    // Arabic letter + dot/dash + space: "A. "
    t = t.replace(/^[\u0621-\u064A]{1,3}[\.\-]\s+/, "");
    return t.trim();
  };

  // question-number line: digit+dot, digit+space+Arabic (question "2 text"), letter+dot+digits
  const isQuestionNumberLine = (s: string): boolean => {
    if (/^[A-Za-z]{1,4}[\.\-]\d{1,3}[\)\.\-\:\s]/i.test(s)) return true;
    if (/^[\u0621-\u064A]{1,3}[\.\-]\s*[\u0660-\u0669]{1,3}[\)\.\-\uFF1D\s]/.test(s)) return true;
    if (/^[\u0660-\u0669]{1,3}[\.\uFF1E\u066B\u06D4]/.test(s)) return true;
    if (/^\d{1,3}[\.\uFF1E]/.test(s)) return true;
    // digit + space + Arabic letter: "2 murder" (question numbering, NOT option which is digit+tight)
    if (/^(?:[\u0660-\u0669]{1,3}|\d{1,3})\s+[\u0621-\u064A]/.test(s)) return true;
    return false;
  };

  // section header: starts with a section keyword (never a question)
  const isSectionHeader = (s: string): boolean =>
    /^(?:\u0642\u0633\u0645|\u0627\u0644\u0641\u0635\u0644|\u0627\u0644\u0648\u062d\u062f\u0629|\u0627\u0644\u062f\u0631\u0633|\u0627\u0644\u0628\u0627\u0628)[\s(\u0600-\u06FF]/.test(s);

  /** أحرف الخيارات العربية الشائعة: أ إ آ ا ب ج د ه ز ح ط ي */
  const AR_OPTION_LETTER = "[\u0623\u0625\u0622\u0627\u0628\u062C\u062F\u0647\u0632\u062D\u0637\u064A]";

  // extract option text: strip prefixes
  const extractOptionText = (s: string): string => {
    let t = s;
    // Arabic-Indic digit + separator: "1- " "1. " "1) "
    t = t.replace(/^[\u0660-\u0669]{1,2}[\-\.\)\uFF1D\uFF1A:]\s*/, "");
    // Arabic-Indic digit + space: "1 "
    t = t.replace(/^[\u0660-\u0669]{1,2}\s+/, "");
    // Arabic-Indic digit tight + Arabic letter: "1murder" (no space)
    t = t.replace(/^[\u0660-\u0669]{1,2}(?=[\u0621-\u064A])/, "");
    // Regular digit + separator/space/tight
    t = t.replace(/^\d{1,2}[\-\.\)\uFF1D\uFF1A:]\s*/, "");
    t = t.replace(/^\d{1,2}\s+/, "");
    // Regular digit tight + Arabic letter: "1murder" (no space)
    t = t.replace(/^\d{1,2}(?=[\u0621-\u064A])/, "");
    // Arabic single letter + paren/dot/colon: "أ) " "أ. " "أ: "
    t = t.replace(/^[\u0621-\u064A][\)\.\uFF1A:]\s*/, "");
    // Arabic option letter + bare space: "أ الرياح"
    t = t.replace(new RegExp("^" + AR_OPTION_LETTER + "\\s+"), "");
    // English letter + paren/dot/colon: "A) " "A. " "A: "
    t = t.replace(/^[A-Za-z]{1,2}[\)\.\uFF1A:]\s*/, "");
    // English option letter + bare space: "A murder"
    t = t.replace(/^[A-Da-d]\s+/, "");
    return t.trim();
  };

  // detect option prefix: digit+separator, digit+tight-Arabic, letter+paren/dot/colon,
  // letter+bare-space (أ الرياح) — (NOT digit+space = question numbering)
  const hasOptionPrefix = (s: string): boolean =>
    /^(?:[\u0660-\u0669]{1,2}|\d{1,2})[\-\.\)\uFF1D\uFF1A:]\s*\S/.test(s) ||
    /^(?:[\u0660-\u0669]{1,2}|\d{1,2})(?=[\u0621-\u064A])/.test(s) ||
    /^[\u0621-\u064A][\)\.\uFF1A:]\s*\S/.test(s) ||
    new RegExp("^" + AR_OPTION_LETTER + "\\s+(?=\\S)").test(s) ||
    /^(?:[\u0621-\u064A]{1,2}|[A-Za-z]{1,2})[\)\uFF1A:]\s*\S/.test(s) ||
    /^[A-Da-d]\s+(?=\S)/.test(s);

  let i = 0;
  let questionNumber = 0;

  /**
   * فصل خيار (أ) الملتحم بنهاية سطر السؤال — شائع في أسئلة التناظر اللفظي:
   * "القلم : كتابة أ الورق" → العنوان "القلم : كتابة" + خيار "الورق".
   * يتسامح مع علامات التظليل [[HL]] حول الحرف أو الخيار، ويشترط أن يبقى
   * قبل الحرف جزء كافٍ من السؤال، وأن يبدأ الذيل بكلمة حقيقية.
   */
  const splitTitleOption = (
    s: string,
  ): { before: string; option: string | null; highlighted: boolean } => {
    const re = new RegExp(
      "(?:^|\\s)(?:\\[\\[HL\\]\\])? ?(" + AR_OPTION_LETTER + "|[A-Da-d])(?:\\[\\[\\/HL\\]\\])?(?:[\\)\\.\uFF1A:]?\\s+(?:\\[\\[HL\\]\\])? ?)([^:]{1,60})$",
    );
    const m = s.match(re);
    if (!m || m.index === undefined) return { before: s, option: null, highlighted: false };
    const before = stripHL(s.slice(0, m.index)).trim();
    const tailClean = stripHL(m[2]).trim();
    if (before.length < 5 || tailClean.length === 0) return { before: s, option: null, highlighted: false };
    // الذيل يجب أن يبدأ بكلمة حقيقية (لا علامة ترقيم)
    if (!/^[\u0621-\u064A0-9A-Za-z]/.test(tailClean)) return { before: s, option: null, highlighted: false };
    const highlighted = s.slice(m.index).includes("[[HL]]");
    return { before, option: tailClean, highlighted };
  };

  while (i < n) {
    const cur = lines[i];
    const curClean = stripHL(cur);
    if (!curClean) { i++; continue; }

    const cleanTitle = stripSourceNumber(curClean);

    // section header lines are never questions
    if (isSectionHeader(curClean) || isSectionHeader(cleanTitle)) { i++; continue; }

    // lookahead: collect option lines following this line
    const options: string[] = [];
    const correctAnswer: string[] = [];
    let prefixedCount = 0;
    let j = i + 1;

    while (j < n) {
      const optRaw = lines[j];
      const optClean = stripHL(optRaw);
      if (!optClean) { j++; continue; }

      // stop at next question (digit+dot, digit+space, section header)
      if (isQuestionNumberLine(optClean) || isSectionHeader(optClean)) break;
      if (optClean.length > 80) break;
      if (/[?\u061F]\s*$/.test(optClean)) break;

      const prefixed = hasOptionPrefix(optClean);
      const hasColon = /^[^:]{1,60}[:\uFF1A]\s*[^:]{1,60}$/.test(optClean);

      // prefixed options always accepted; bare "word : word" only before any prefixed option
      const isOpt = prefixed || (hasColon && prefixedCount === 0);
      if (!isOpt) break;

      const optText = extractOptionText(optClean);
      if (optText.length > 0) {
        options.push(optText);
        if (hasHL(optRaw)) correctAnswer.push(optText);
        if (prefixed) prefixedCount++;
      }
      j++;
      if (options.length >= 4) break;  // standard MCQ count
    }

    // if 2+ options found, this line is a QUESTION
    if (options.length >= 2) {
      questionNumber++;
      // فصل خيار (أ) الملتحم بنهاية سطر السؤال (تناظر لفظي) — يبقى التناظر في العنوان
      const split = splitTitleOption(cur);
      let title = cleanTitle;
      if (split.option) {
        title = stripSourceNumber(split.before);
        options.unshift(split.option);
        if (split.highlighted) correctAnswer.unshift(split.option);
      }
      blocks.push({
        kind: "radio",
        title: questionNumber + ". " + title,
        options: options,
        correct: correctAnswer.length > 0 ? correctAnswer : undefined,
        required: true,
      });
      i = j;
      continue;
    }

    // orphaned prefixed option line (no parent question) - skip
    if (hasOptionPrefix(curClean)) { i++; continue; }

    // short line without question mark - likely leftover header, skip
    if (cleanTitle.length < 40 && !/[\u061F?]/.test(cleanTitle)) { i++; continue; }

    // long line without options - short answer question
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
