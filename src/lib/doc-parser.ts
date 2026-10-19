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
  correct?: string;
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
  // تحويل الأف-tab والرأسية إلى أسطر عادية
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u000B/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "لا توجد أسئلة بعد");

  const blocks: ParsedBlock[] = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const cur = normalizeArabic(lines[i]);
    if (!cur) { i++; continue; }

    /*─────────────────────────────
      1. زوج شبيه "كلمة : معنى"
      يُنجز كل pair كسؤال إجابة قصيرة (العنوان = الزوج، الإجابة المقترحة = الجزء الثاني)
     ─────────────────────────────*/
    const analogy = cur.match(ANALOGY_RE);
    if (analogy && !isLikelyQuestion(cur)) {
      const a = normalizeArabic(analogy[1]);
      const b = normalizeArabic(analogy[2]);
      // لا نتعامل كزوج شبيه إذا كان الجزء الثاني طويلاً (ليست خياراً قصيراً)
      if (b.length <= 40) {
        blocks.push({
          kind: "short",
          title: `أكمل العلاقة: ${a} : ؟`,
          options: [],
          correct: b,
          required: true,
        });
        i++;
        continue;
      }
    }

    /*─────────────────────────────
      2. سؤال طويل يتبعه أسطر قصيرة = اختيارات
     ─────────────────────────────*/
    if (isLikelyQuestion(cur) || cur.length > 40) {
      const title = cur;
      const options: string[] = [];
      let j = i + 1;
      // جمّع الأسطر القصيرة التالية كخيرات
      while (j < n && isShortOption(lines[j]) && options.length < 6) {
        const opt = normalizeArabic(lines[j]);
        if (opt.length > 0) options.push(opt);
        j++;
      }
      if (options.length >= 2) {
        blocks.push({
          kind: "radio",
          title,
          options,
          required: true,
        });
        i = j;
        continue;
      }
      // لا توجد اختيارات → سؤال إجابة قصيرة
      blocks.push({
        kind: "short",
        title,
        options: [],
        required: true,
      });
      i++;
      continue;
    }

    /*─────────────────────────────
      3. سطر قصير منفرد (قد يكون خياراً لمركبة سابقة أو سؤال مكتمل)
     ─────────────────────────────*/
    blocks.push({
      kind: "short",
      title: cur,
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
    q.correct = b.correct ? [b.correct] : [];
    // إذا كان من نوع إجابة قصيرة وكان لديه إجابة مقترحة، اجعلها مفتاحاً (اختبار مصحح)
    if (q.type === "short" && b.correct) {
      q.correct = [b.correct];
    }
    return q;
  });
}
