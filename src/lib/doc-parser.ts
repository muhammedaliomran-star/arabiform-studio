import type { Question } from "@/lib/form-types";
import { newQuestion, uid } from "@/lib/form-types";

/** نتيجة تحليل كتلة نصية واحدة قبل العرض في شاشة المعاينة */
export type ParsedBlock = {
  /** نوع السؤال المقترح (يعدلها المستخدم في المعاينة) */
  kind: "radio" | "checkbox" | "short" | "paragraph" | "text" | "truefalse";
  /** نص السؤال (يعدل) */
  title: string;
  /** الخيرات المقترحة (يعدل/يحذف/يزيد) */
  options: string[];
  /** الإجابة الصحيحة المقترحة إن وجدت (يترك فارغاً لو غير متأكد) */
  correct?: string[];
  /** نص المقروءة/الفقرة التمهيدية (نوع "text" فقط) */
  text?: string;
  /** هل السؤال مطلوب */
  required: boolean;
  /** درجة السؤال في الاختبار (يعدّلها المستخدم في شاشة المراجعة) */
  points?: number;
  /** رقم السؤال في ملف المصدر — يُستخدم لربط مفتاح الإجابة بالسؤال */
  sourceNo?: number;
};

/** إزالة التشكيل والمسافات الزائدة والطول الزائد (tatweel) */
function normalizeArabic(s: string): string {
  return s
    .replace(/\u0640/g, "") // tatweel
    .replace(/[\u064B-\u0652\u0610-\u061A]/g, "") // harakat / diacritics
    .replace(/\s+/g, " ")
    .trim();
}

/** فقرة نثر تمهيدي (مقروءة) — تُحفظ كنص وصفي بدون إجابة بدل تجاهلها */
function isPassageBody(s: string): boolean {
  const t = normalizeArabic(s);
  if (t.length < 35) return false;
  // ليس سؤالاً ولا خياراً مرقّماً ولا استفهامياً
  if (/^[؟?]/.test(t) || /[؟?]\s*$/.test(t)) return false;
  if (/^(?:[\u0660-\u0669]{1,2}|\d{1,2})[\-\.\)\uFF1D\uFF1A:]/.test(t)) return false;
  if (/^[\u0660-\u0669\d]{1,2}[\s]*[\u0621-\u064A]/.test(t)) return false;
  return true;
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
    // Regular digits + dash/paren: "1- " "1) " (ترقيم شائع في ملفات الامتحانات)
    t = t.replace(/^\d{1,3}[\-\)\u2013\uFF1D]\s*/, "");
    // Arabic-Indic digits + dash/paren: "١- " "١) "
    t = t.replace(/^[\u0660-\u0669]{1,3}[\-\)\u2013\uFF1D]\s*/, "");
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
    // "1- ما هو ...؟" / "3) من هو ...؟" / "2- ... (صح / خطأ)" — رقم + فاصل + نص
    // ينتهي باستفهام أو يحمل علامة صح/خطأ (الخيارات لا تنتهي بعلامة استفهام).
    if (
      /^(?:[\u0660-\u0669]{1,3}|\d{1,3})[\-\)\u2013\uFF1D]\s*\S/.test(s) &&
      (/[\u061F?]\s*$/.test(s) || TF_MARKER_RE.test(s))
    )
      return true;
    return false;
  };

  // section header: starts with a section keyword (never a question)
  const isSectionHeader = (s: string): boolean =>
    /^(?:\u0642\u0633\u0645|\u0627\u0644\u0641\u0635\u0644|\u0627\u0644\u0648\u062d\u062f\u0629|\u0627\u0644\u062f\u0631\u0633|\u0627\u0644\u0628\u0627\u0628)[\s(\u0600-\u06FF]/.test(s);

  /**
   * بداية كتلة نص تمهيدي (مقروءات) — علامة مربعة أو عنوان "نص (العنوان)".
   * فقرات كتلة كهذه نثر تعليمي وليس أسئلة، وتُتجاهل حتى السؤال المرقّم التالي.
   */
  const PASSAGE_MARK_RE = /^[\u25A0\u25AA\u25CF\u2605\u25A1\u2B1B\u258C]\s*\S/;
  const PASSAGE_TITLE_RE =
    /^(?:\u0646\u0635|\u0627\u0644\u0646\u0635|\u0627\u0644\u0642\u0631\u0627\u0621\u0629|\u0627\u0644\u0642\u0635\u0629|\u0627\u0644\u0627\u0633\u062A\u0645\u0627\u0639|\u0627\u0644\u0645\u0642\u0631\u0648\u0621|\u0627\u0644\u0646\u0635 \u0627\u0644\u062A\u0645\u0647\u0649\u062F\u064A)\s*[\(\uFF08]\s*\S/;

  /** سطر نثر تمهيدي غير مرقّم: طويل (100+) أو طويل جداً (150+) حتى لو انتهى بعلامة استفهام */
  const PROSE_SOFT_LENGTH = 100;
  const PROSE_HARD_LENGTH = 150;

  /** فجوة إجابة يملؤها الطالب: "...." أو "____" */
  const hasAnswerBlank = (s: string): boolean => /_{2,}|\.{4,}|\u2026{1,}/.test(s);

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

  /*==============================================================================
    مفتاح الإجابة — صيغ شائعة في ملفات وورد:
      "الإجابة: ب" / "الإجابة الصحيحة: ج" / "Answer: B"
      أو قائمة في نهاية الملف: "1- ب" / "2. C"
    نقرأها في مسحة أولى ونربطها بالسؤال برقم السؤال في المصدر.
    قاعدة صارمة: إن لم يُوجد مفتاح للسؤال لا نُخمّن — يبقى بدون إجابة صحيحة.
  ==============================================================================*/
  /** "الإجابة: ب" / "الإجابة الصحيحة: صح" / "الجابة: ج" (بهمزتها أو بدونها) */
  const ANSWER_INLINE_RE =
    /^(?:الإجابة|الاجابة|الجابة)(?:\s*الصحيحة)?(?:\s*هي)?\s*[:：]\s*(?:الخيار\s+)?(صح|صواب|خطأ|[A-Za-z]|[أ-ي])\.?\s*$/i;
  /** "Answer: B" / "Correct answer: C" */
  const ANSWER_EN_RE =
    /^(?:answer|correct(?:\s*answer)?|the\s*answer)\s*(?:is)?\s*[:：]\s*(?:option\s*)?(صح|صواب|خطأ|[A-Za-z])\.?\s*$/i;
  /** قائمة مفتاح الإجابة: "1- ب" / "2. C" / "12: صح" */
  const ANSWER_KEY_RE =
    /^(?:[\u0660-\u0669]{1,3}|\d{1,3})\s*[\-\.\)\uFF1D\uFF1A:]\s*(?:إجابة\s*)?(صح|صواب|خطأ|[A-Za-z]|[أ-ي])\.?\s*$/i;

  /** هل السطر صيغة إجابة؟ يُقرأ في المسحة الأولى ثم يُتخطّى في المعالجة */
  const isAnswerLine = (s: string): boolean =>
    ANSWER_INLINE_RE.test(s) || ANSWER_EN_RE.test(s) || ANSWER_KEY_RE.test(s);

  /** تحويل رقم عربي-هندي/غربي إلى قيمة عددية */
  const toWesternNum = (s: string): number =>
    Number(s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)));

  /** الرقم على بداية السطر (مع تجاهل بادئة نوع "V.1" و"أ.3") */
  const extractLeadingNum = (s: string): number => {
    const m = s.match(/^(?:[A-Za-z]{1,4}[\.\-])?([\u0660-\u0669]{1,3}|\d{1,3})/);
    return m ? toWesternNum(m[1]) : 0;
  };

  /** ترتيب حروف الخيارات الشائع في الامتحانات: أ ب ج د هـ و ز ح ط ي ك ل م ن س ع ف ص ق ر ش ت ث خ ذ ض ظ غ */
  const OPTION_LETTERS = "أبجدهوزحطيكلمنس عفصقرشتثخذضظغ".replace(/\s/g, "");

  /** تحويل حرف خيار (عربي/إنجليزي) إلى فهرس الخيار — undefined عند التعذّر */
  const letterToIndex = (raw: string): number | undefined => {
    const t = raw.trim();
    if (/^[A-Za-z]$/.test(t)) {
      const idx = "ABCDEFGHIJ".indexOf(t.toUpperCase());
      return idx >= 0 ? idx : undefined;
    }
    const n = t.replace(/[\u064B-\u0652\u0640\u0670]/g, "");
    const c = /^[\u0623\u0625\u0622\u0627]$/.test(n) ? "\u0623" : n;
    const idx = OPTION_LETTERS.indexOf(c);
    return idx >= 0 ? idx : undefined;
  };

  /** كلمات نوع صح/خطأ */
  const TF_WORDS_SET = new Set(["صح", "خطأ"]);
  /** توحيد "صواب" إلى "صح" وإزالة الأقوال */
  const normalizeTFWord = (s: string): string => {
    const t = s.replace(/[（()\uFF09\s]/g, "");
    return t === "صواب" ? "صح" : t;
  };
  /** سطر خيار صح/خطأ منفصل: "صح" أو "(خطأ)" */
  const TF_WORD_RE = /^[（(]?\s*(?:صح|صواب|خطأ)\s*[)）]?$/;
  /** علامة النوع داخل نص السؤال: "(صح / خطأ)" / "صواب أم خطأ" / "صح-خطأ" */
  const TF_MARKER_RE =
    /[（(]?\s*(?:صح|صواب)\s*(?:\/|–|—|-|،|,|و|أم|أو)\s*خطأ\s*[)）]?/;

  // مسحة أولى: بناء مفتاح الإجابة من سطور الإجابة وقوائم النهاية
  const answerKey = new Map<number, string>();
  let lastSrcNo = 0;
  for (const rawLine of lines) {
    const s = stripHL(rawLine).trim();
    if (!s) continue;
    if (isQuestionNumberLine(s)) {
      const v = extractLeadingNum(s);
      if (v > 0) lastSrcNo = v;
    }
    const inline = ANSWER_INLINE_RE.exec(s) ?? ANSWER_EN_RE.exec(s);
    if (inline) {
      if (lastSrcNo > 0) answerKey.set(lastSrcNo, inline[1]);
      continue;
    }
    const key = ANSWER_KEY_RE.exec(s);
    if (key) {
      const v = extractLeadingNum(s);
      const target = v > 0 ? v : lastSrcNo;
      if (target > 0) answerKey.set(target, key[1]);
    }
  }

  /** رقم السؤال في المصدر كما ورد في الملف (يرتبط بمفتاح الإجابة) */
  const extractSourceNo = (s: string): number | undefined => {
    const v = extractLeadingNum(stripHL(s).trim());
    return v > 0 ? v : undefined;
  };

  /**
   * تحويل رمز المفتاح ("ب" / "صح") إلى خيار فعلي.
   * يعيد undefined بدل التخمين عندما لا يطابق الرمز خيارات السؤال.
   */
  const resolveAnswerToken = (
    token: string,
    options: string[],
  ): string | undefined => {
    const t = token.trim();
    if (t === "صح" || t === "صواب" || t === "خطأ") {
      const w = normalizeTFWord(t);
      return options.find((o) => normalizeTFWord(o.trim()) === w);
    }
    const idx = letterToIndex(t);
    if (idx === undefined || idx >= options.length) return undefined;
    return options[idx];
  };

  let i = 0;
  let questionNumber = 0;

  /*==============================================================================
    تجميع أسئلة الجداول (4 أعمدة) — ملفات وورد التي تضع كل سؤال في صف جدول:
    السطر الأول نص السؤال (بصيغة "كلمة : كلمة" أو جملة/فجوة)، ثم 4 خيارات،
    كل خيار يسبقه سطر يحمل حرف الخيار المنفصل (أ/ب/ج/د) وقد يكون مظللاً [[HL]].
    نعيد كتلة سؤال واحدة لكل مجموعة قبل المعالجة العامة.
  ==============================================================================*/
  const OPTION_LETTER_LINE_RE =
    /^[\[٠-٩]*\s*(?:\[\[HL\]\]\s*)?([أإآاهـدجزحطييكلمنسعفرصقشثخذضظغ]|[A-Da-d])(?:\s*[\)\.\uFF1A:])?(?:\s*\[\[\/HL\]\])?$/;

  const isOptionLetterLine = (s: string): boolean => OPTION_LETTER_LINE_RE.test(s);

  /** نص خيار مكتوب "كلمة : كلمة" أو كلمة/عبارة قصيرة (فجوة الإجابة) */
  const isOptionTextLine = (s: string): boolean => {
    const t = stripHL(s).trim();
    if (!t || t.length > 80) return false;
    if (isOptionLetterLine(t)) return false;
    if (/[؟?]\s*$/.test(t)) return false;
    if (/^[^:：]{1,60}[:：]\s*[^:：]{1,60}$/.test(t)) return true;
    // كلمة/عبارة قصيرة بدون استفهام (خيارات أسئلة الإكمال)
    return t.length <= 40 && !isQuestionNumberLine(t) && !isSectionHeader(t);
  };

  /** نص السؤال: سطر يسبق مجموعة الخيارات مباشرة */
  const isQuestionStemLine = (s: string): boolean => {
    const t = stripHL(s).trim();
    if (!t || t.length > 200) return false;
    if (isOptionLetterLine(t)) return false;
    return true;
  };

  /**
   * حاول تجميع صف جدول سؤال يبدأ عند السطر i.
   * يعيد null إذا لم تكن مجموعة أسئلة صحيحة (2+ خيارات).
   */
  const tryParseTableQuestion = (
    start: number,
  ): { title: string; options: string[]; correct: string[]; stemIsOption: boolean; end: number } | null => {
    const stemRaw = lines[start];
    if (!isQuestionStemLine(stemRaw)) return null;

    const options: string[] = [];
    const correct: string[] = [];
    let labeledCount = 0; // عدد الخيارات التي لها تسمية حرف على سطر مستقل
    let j = start + 1;

    // إذا كان نص السؤال نفسه خيار تناظر "كلمة : كلمة" (أو مظللاً) فهو الخيار (أ)
    // — شائع في أسئلة التناظر اللفظي: عمود الجدول الأول يحمل الخيار المظلل.
    const stemClean0 = stripHL(stemRaw).trim();
    const stemIsAnalogy = /^[^:：]{2,40}[:：]\s*[^:：]{2,40}$/.test(stemClean0);
    if (stemIsAnalogy || hasHL(stemRaw)) {
      const optText = extractOptionText(stemClean0);
      if (optText && optText.length > 0) {
        options.push(optText);
        if (hasHL(stemRaw)) correct.push(optText);
      }
    }

    while (j < n) {
      const raw = lines[j];
      const clean = stripHL(raw).trim();
      if (!clean) { j++; continue; }

      // حرف خيار منفصل (أ/ب/ج/د) — النص يليه على السطر التالي
      if (isOptionLetterLine(clean)) {
        // ابحث عن نص الخيار بعد هذا الحرف (تخطِّ الفواصل)
        let k = j + 1;
        while (k < n && !stripHL(lines[k]).trim()) k++;
        if (k >= n) break;
        const textRaw = lines[k];
        const textClean = stripHL(textRaw).trim();
        if (!isOptionTextLine(textClean)) break;
        const optText = extractOptionText(textClean);
        if (optText) {
          options.push(optText);
          labeledCount++;
          // الحرف أو النص مظللاً = الإجابة الصحيحة
          if (hasHL(raw) || hasHL(textRaw)) correct.push(optText);
        }
        j = k + 1;
        if (options.length >= 4) break;
        continue;
      }

      break;
    }

    // لا نعتبر هذا السؤال "جدولياً" إلا إذا احتوى خيارات مُسمّاة بحروف على
    // أسطر مستقلة (بُعد جدول حقيقي). وإلا نترك الإدخال للمُعالج العام كي لا
    // يبتلع صيغ الربط (القلم : كتابة أ الورق) أو التناظر البسيط.
    if (labeledCount < 2) return null;
    if (options.length < 2) return null;
    // العنوان نص السؤال الأصلي (لا نحذف الخيار المُظلل من العنوان).
    const title = stripSourceNumber(stripHL(stemRaw)).trim();
    if (!title) return null;
    const stemIsOption = (stemIsAnalogy || hasHL(stemRaw)) && options.length > 0;
    return { title, options, correct, stemIsOption, end: j };
  };

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

    // سطور مفتاح الإجابة ("الإجابة: ب" / "1- ج") — تُقرأ في المسحة الأولى وتُتخطّى هنا
    if (isAnswerLine(curClean)) { i++; continue; }

    // بداية كتلة نص تمهيدي (مقروءات): "■ نص (الأرض والقمر)" — تُحفظ كنص وصفي بدون إجابة
    if (PASSAGE_MARK_RE.test(curClean) || PASSAGE_TITLE_RE.test(curClean)) {
      const passageTitle = curClean
        .replace(/^[\u25A0\u25AA\u25CF\u2605\u2610\u25FC]\s*/, "")
        .trim();
      i++;
      // اجمع فقرات المقروءة حتى السؤال المرقّم التالي أو بداية قسم/مقروءة جديدة
      const paragraphs: string[] = [];
      while (i < n) {
        const pClean = stripHL(lines[i]);
        if (!pClean) { i++; continue; }
        if (
          isQuestionNumberLine(pClean) ||
          PASSAGE_MARK_RE.test(pClean) ||
          PASSAGE_TITLE_RE.test(pClean) ||
          isSectionHeader(pClean)
        ) {
          break;
        }
        const pContent = stripSourceNumber(pClean).trim();
        if (isPassageBody(pContent)) paragraphs.push(pContent);
        i++;
      }
      if (paragraphs.length) {
        blocks.push({
          kind: "text",
          title: passageTitle,
          options: [],
          required: false,
          text: paragraphs.join("\n"),
        });
      }
      continue;
    }

    const cleanTitle = stripSourceNumber(curClean);
    const numberedLine = isQuestionNumberLine(curClean);

    // section header lines are never questions
    if (isSectionHeader(curClean) || isSectionHeader(cleanTitle)) { i++; continue; }

    // ===== سؤال صح / خطأ: نص السؤال يحمل العلامة "(صح / خطأ)" أو "صواب أم خطأ" =====
    if (TF_MARKER_RE.test(curClean)) {
      questionNumber++;
      let tfTitle = stripSourceNumber(stripHL(cur))
        .replace(TF_MARKER_RE, " ")
        .replace(/\s*[:：]\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!tfTitle) tfTitle = "صح أم خطأ";
      const correctTf: string[] = [];
      let j = i + 1;
      // خيارات "صح"/"خطأ" على أسطر منفصلة (مع تظليل محتمل) أو خلف حرف خيار منفصل
      while (j < n && j <= i + 6) {
        const rawL = lines[j];
        const c = stripHL(rawL).trim();
        if (!c) { j++; continue; }
        if (TF_WORD_RE.test(c)) {
          const w = normalizeTFWord(c);
          if (hasHL(rawL)) correctTf.push(w);
          j++;
          continue;
        }
        if (isOptionLetterLine(c)) {
          let k = j + 1;
          while (k < n && !stripHL(lines[k]).trim()) k++;
          if (k < n && TF_WORD_RE.test(stripHL(lines[k]).trim())) {
            const w = normalizeTFWord(stripHL(lines[k]).trim());
            if (hasHL(rawL) || hasHL(lines[k])) correctTf.push(w);
            j = k + 1;
            continue;
          }
        }
        break;
      }
      blocks.push({
        kind: "truefalse",
        title: questionNumber + ". " + tfTitle,
        options: ["صح", "خطأ"],
        correct: correctTf.length === 1 ? [correctTf[0]] : undefined,
        required: true,
        sourceNo: extractSourceNo(cur),
      });
      i = j;
      continue;
    }
    // =====================================================================

    // ===== تجميع صف جدول سؤال (4 أعمدة) — أولوية على المعالجة العامة =====
    const tableQ = tryParseTableQuestion(i);
    if (tableQ) {
      questionNumber++;
      blocks.push({
        kind: "radio",
        title: questionNumber + ". " + tableQ.title,
        options: tableQ.options,
        correct: tableQ.correct.length > 0 ? tableQ.correct : undefined,
        required: true,
        sourceNo: extractSourceNo(lines[i]),
      });
      i = tableQ.end;
      continue;
    }
    // =====================================================================

    // lookahead: collect option lines following this line
    const options: string[] = [];
    const correctAnswer: string[] = [];
    let prefixedCount = 0;
    let j = i + 1;

    while (j < n) {
      const optRaw = lines[j];
      const optClean = stripHL(optRaw);
      if (!optClean) { j++; continue; }

      // سطر مفتاح إجابة بعد الخيارات — لا يُبتلع كخيار
      if (isAnswerLine(optClean)) break;

      // stop at next question (digit+dot, digit+space, section header)
      if (isQuestionNumberLine(optClean) || isSectionHeader(optClean)) break;
      // stop at the start of an intro/passage block
      if (PASSAGE_MARK_RE.test(optClean) || PASSAGE_TITLE_RE.test(optClean)) break;
      if (optClean.length > 80) break;
      if (/[?\u061F]\s*$/.test(optClean)) break;

      // خيار صح/خطأ منفصل بدون بادئة حرف ("صح" / "(خطأ)")
      if (TF_WORD_RE.test(optClean)) {
        const w = normalizeTFWord(optClean);
        options.push(w);
        if (hasHL(optRaw)) correctAnswer.push(w);
        j++;
        prefixedCount++;
        continue;
      }

      // حرف خيار منفصل يليه نص "صح"/"خطأ" (تنسيق جدول لسؤال صح-خطأ)
      if (isOptionLetterLine(optClean)) {
        let k = j + 1;
        while (k < n && !stripHL(lines[k]).trim()) k++;
        if (k < n && TF_WORD_RE.test(stripHL(lines[k]).trim())) {
          const w = normalizeTFWord(stripHL(lines[k]).trim());
          options.push(w);
          if (hasHL(optRaw) || hasHL(lines[k])) correctAnswer.push(w);
          j = k + 1;
          prefixedCount++;
          continue;
        }
        break;
      }

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
      // كل الخيارات من كلمات صح/خطأ → نوع "صح وخطأ" بخيارات موحّدة ["صح", "خطأ"]
      const tfUnique = [...new Set(options.map(normalizeTFWord))].filter((w) =>
        TF_WORDS_SET.has(w),
      );
      const isTF = options.every((o) => TF_WORDS_SET.has(normalizeTFWord(o))) && tfUnique.length >= 2;
      const finalOptions = isTF ? tfUnique : options;
      const finalCorrect = isTF
        ? [...new Set(correctAnswer.map(normalizeTFWord))].filter((w) =>
            TF_WORDS_SET.has(w),
          )
        : correctAnswer;
      blocks.push({
        kind: isTF ? "truefalse" : "radio",
        title: questionNumber + ". " + title,
        options: finalOptions,
        correct: finalCorrect.length > 0 ? finalCorrect : undefined,
        required: true,
        sourceNo: extractSourceNo(cur),
      });
      i = j;
      continue;
    }

    // orphaned prefixed option line (no parent question) - skip
    // (ما لم يكن سطراً مرقّماً بصيغة "3- ..." الطويل — فقد يكون سؤالاً مقاليّاً لا خياراً يتيمّاً)
    const longNumberedEssay =
      /^(?:[\u0660-\u0669]{1,3}|\d{1,3})[\-\)\u2013\uFF1D]\s*\S/.test(curClean) &&
      curClean.length > 60;
    if (hasOptionPrefix(curClean) && !numberedLine && !longNumberedEssay) { i++; continue; }

    // فقرة نثر تمهيدية (مقروءات/شرح) — ليست سؤالاً: تُحفظ كنص وصفي بدون إجابة
    if (!numberedLine && !hasAnswerBlank(cleanTitle)) {
      if (isPassageBody(cleanTitle)) {
        blocks.push({ kind: "text", title: "", options: [], required: false, text: cleanTitle });
        i++;
        continue;
      }
      if (cleanTitle.length >= PROSE_HARD_LENGTH) { i++; continue; }
      // طويل ولا ينتهي بعلامة استفهام → نص تمهيدي
      if (cleanTitle.length >= PROSE_SOFT_LENGTH && !/[\u061F?]\s*[!.]?\s*$/.test(cleanTitle)) {
        i++;
        continue;
      }
    }

    // short line without question mark - likely leftover header, skip
    if (cleanTitle.length < 40 && !/[\u061F?]/.test(cleanTitle)) { i++; continue; }

    // long line without options - short answer question
    questionNumber++;
    blocks.push({
      kind: "short",
      title: questionNumber + ". " + cleanTitle,
      options: [],
      required: true,
      sourceNo: extractSourceNo(cur),
    });
    i++;
  }

  /*==============================================================================
    ربط مفتاح الإجابة بالأسئلة (إن وُجد في الملف).
    التظليل الأصفر في الملف له الأولوية، ولا تخمين أبداً:
    إن لم يُطابق رمز المفتاح خيارات السؤال يبقى السؤال بدون إجابة صحيحة.
  ==============================================================================*/
  if (answerKey.size > 0) {
    for (const b of blocks) {
      if (b.kind !== "radio" && b.kind !== "checkbox" && b.kind !== "truefalse") continue;
      if (b.correct && b.correct.length > 0) continue;
      if (!b.sourceNo) continue;
      const token = answerKey.get(b.sourceNo);
      if (!token) continue;
      const hit = resolveAnswerToken(token, b.options);
      if (hit) b.correct = [hit];
    }
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
      b.kind === "radio" || b.kind === "truefalse"
        ? "radio"
        : b.kind === "checkbox"
          ? "checkbox"
          : b.kind === "paragraph"
            ? "paragraph"
            : b.kind === "text"
              ? "text"
              : "short",
    );
    q.id = uid();
    q.title = b.title || (b.kind === "text" ? "نص وصفي" : `سؤال ${idx + 1}`);
    // نص المقروءة التمهيدية يُحفظ في الوصف حتى يظهر تحت العنوان في المعاينة والنموذج
    q.description = b.kind === "text" ? (b.text ?? "") : "";
    q.required = b.required;
    q.options = b.options.filter((o) => o.length > 0);
    q.correct = b.correct ?? [];
    // درجة السؤال في الاختبار (النصوص الوصفية بلا درجة)
    if (b.kind !== "text") {
      q.points = typeof b.points === "number" && b.points >= 0 ? b.points : 1;
    }
    return q;
  });
}
