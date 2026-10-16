export type QType =
  | "short"
  | "paragraph"
  | "radio"
  | "checkbox"
  | "dropdown"
  | "scale"
  | "date"
  | "time"
  | "rating"
  | "signature"
  | "file"
  | "section"
  | "text"
  | "image";

/** قاعدة تحقق نصية منسوخة من نموذج جوجل: op=4 تعني "يحتوي على" */
export type TextValidation = {
  op: number;
  args: string[];
  message?: string;
};

export type Question = {
  id: string;
  title: string;
  description: string;
  type: QType | "unknown";
  required: boolean;
  options: string[];
  /** data URL for an optional question image */
  image?: string;
  /** Google Drive image IDs attached to the question (public link built at render) */
  images?: string[];
  /** option value -> target section question id, or "__end" to jump to submit */
  goTo?: Record<string, string>;
  /** max stars for the rating type */
  max?: number;
  /** quiz points for this question */
  points?: number;
  /** correct option values (used when the form is a quiz) */
  correct?: string[];
  /** text validation rule (short/paragraph) */
  validation?: TextValidation;
  /** Google's internal item id (for matching score imports) */
  gid?: string;
  /** Google form entry id (for building prefill links) */
  entryId?: string;
};

/** هوية النموذج البصرية المستنسخة من نموذج جوجل الأصلي */
export type FormTheme = {
  /** اللون الأساسي (HEX مثل #CE9492) */
  accent: string;
  /** لون الخلفية الفاتح المشتق */
  background: string;
  /** درجة غامقة للحدود والنصوص */
  dark: string;
  /** اسم الخط (Cairo افتراضياً للعربية) */
  font: string;
};

export type FormDoc = {
  id: string;
  title: string;
  description: string;
  sourceUrl?: string;
  questions: Question[];
  updatedAt: number;
  /** turn the exported Google Form into a graded quiz */
  isQuiz?: boolean;
  /** Google Drive image ID used as the form header/banner */
  headerImage?: string;
  /** visual identity cloned from the source Google Form */
  theme?: FormTheme;
};

export type Answer = string | string[];
export type FormResponse = {
  id: string;
  submittedAt: number;
  answers: Record<string, Answer>;
};

export type Store = { forms: FormDoc[]; responses: Record<string, FormResponse[]> };

export const TYPE_LABEL: Record<QType, string> = {
  short: "إجابة قصيرة",
  paragraph: "فقرة",
  radio: "اختيار من متعدد",
  checkbox: "مربعات اختيار",
  dropdown: "قائمة منسدلة",
  scale: "مقياس خطي",
  date: "تاريخ",
  time: "وقت",
  rating: "تقييم بالنجوم",
  signature: "توقيع",
  file: "رفع ملف",
  section: "قسم جديد (فاصل صفحات)",
  text: "نص وصفي (بدون إجابة)",
  image: "صورة (بدون إجابة)",
};

export const OPTION_TYPES: QType[] = ["radio", "checkbox", "dropdown", "scale"];

/** أنواع لا تقبل إجابة (عناوين/فواصل/صور/غير معروف) */
export const NON_ANSWER_TYPES: Array<Question["type"]> = ["section", "text", "image", "unknown"];

export function isAnswerable(q: Question): boolean {
  return !NON_ANSWER_TYPES.includes(q.type);
}

/** Public view URL for a Google Drive image (works when shared as "anyone with the link"). */
export function driveImageUrl(id: string): string {
  return `https://lh3.googleusercontent.com/d/${id}`;
}

/** Public view page URL for a Google Drive file (fallback when the direct image is blocked). */
export function driveFileUrl(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`;
}

/** Extract a Drive file ID from a raw ID or a full Drive URL. */
export function extractDriveId(s: string): string | null {
  const t = s.trim();
  if (/^[A-Za-z0-9_-]{25,}$/.test(t)) return t;
  const m = t.match(/[?&]id=([A-Za-z0-9_-]{25,})|\/d\/([A-Za-z0-9_-]{25,})/);
  return m ? (m[1] ?? m[2]) : null;
}

/** Darken/lighten a #RRGGBB hex color by percent (-100..100). */
export function shadeHex(hex: string, percent: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent) / 100;
  const c = (v: number) => Math.round(v + (t - v) * p);
  const r = c(n >> 16);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()}`;
}

/** Normalize Arabic answer text for comparison (diacritics/tatweel/whitespace). */
export function normalizeAnswer(s: string): string {
  return s
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ScoreKey = { gid: string; total: number; correct?: string };
/**
 * Apply imported score keys to questions: match by Google id first,
 * fall back to document order for id-less (old) clones. Sets correct[] + points.
 * Returns updated questions + report. `foreign` = score link is for another form.
 */
export function applyScoreKeys(
  questions: Question[],
  scores: ScoreKey[],
): { questions: Question[]; matched: number; unmatched: string[]; foreign: boolean } {
  const byGid = new Map(scores.map((s) => [s.gid, s]));
  const answerable = questions.filter(isAnswerable);
  const withGid = answerable.filter((q) => q.gid && byGid.has(q.gid));
  const hasGids = answerable.some((q) => q.gid);
  // رابط لنموذج مختلف: النموذج له معرفات لكنها لا تتقاطع مع النتيجة
  if (hasGids && scores.length >= 3 && withGid.length * 2 < Math.min(scores.length, answerable.length)) {
    return { questions, matched: 0, unmatched: [], foreign: true };
  }

  const gidSet = new Set(withGid.map((q) => q.gid as string));
  const orderPool = scores.filter((s) => !gidSet.has(s.gid));
  let orderIdx = 0;
  let matched = 0;
  const unmatched: string[] = [];
  const withPoints = (q: Question, sk: ScoreKey): Question =>
    sk.total > 0 ? { ...q, points: sk.total } : q;

  const next = questions.map((q) => {
    if (!isAnswerable(q)) return q;
    let sk: ScoreKey | undefined;
    if (q.gid && byGid.has(q.gid)) {
      sk = byGid.get(q.gid);
    } else {
      // احتياطي الترتيب للنسخ القديمة بلا معرفات (نفس ترتيب النموذج)
      sk = orderPool[orderIdx++];
    }
    if (!sk) return q;
    const label = q.title.trim() || "سؤال بدون عنوان";
    if (!sk.correct) {
      unmatched.push(label);
      return withPoints(q, sk);
    }
    const hit = q.options.find((o) => normalizeAnswer(o) === normalizeAnswer(sk.correct as string));
    if (!hit) {
      unmatched.push(label);
      return withPoints(q, sk);
    }
    matched++;
    return { ...withPoints(q, sk), correct: [hit] };
  });

  return { questions: next, matched, unmatched, foreign: false };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newQuestion(type: QType = "short"): Question {
  const titles: Partial<Record<QType, string>> = {
    section: "قسم جديد",
    text: "نص وصفي",
    image: "صورة",
  };
  return {
    id: uid(),
    title: titles[type] ?? "سؤال جديد",
    description: "",
    type,
    required: false,
    options: OPTION_TYPES.includes(type) ? ["خيار 1", "خيار 2"] : [],
    max: type === "rating" ? 5 : undefined,
  };
}

/** Split a form's questions into pages separated by "section" markers. */
export function paginate(questions: Question[]) {
  const pages: Array<{ section: Question | null; items: Question[] }> = [];
  let current: { section: Question | null; items: Question[] } = { section: null, items: [] };
  for (const q of questions) {
    if (q.type === "section") {
      if (current.items.length || current.section) pages.push(current);
      current = { section: q, items: [] };
    } else {
      current.items.push(q);
    }
  }
  if (current.items.length || current.section) pages.push(current);
  return pages.length ? pages : [{ section: null, items: [] }];
}

/**
 * Build a prefilled viewform URL that opens the SOURCE Google Form with dummy
 * answers already filled (first option / sample text / validation-passing text).
 * The user reviews and submits manually, then imports keys from the score link.
 * Returns null when the form has no source URL or no entry ids (old clones).
 */
export function buildPrefillUrl(form: FormDoc): string | null {
  if (!form.sourceUrl) return null;
  const params = new URLSearchParams();
  params.set("usp", "pp_url");
  let n = 0;
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  for (const q of form.questions) {
    if (!q.entryId || !isAnswerable(q)) continue;
    let v: string | undefined;
    if (q.validation && q.validation.args.length) {
      // قيمة تجتاز قاعدة "يحتوي على" (مثل كلمة السر) حتى لا يعلق الإرسال
      v = q.validation.args[0];
    } else if (q.type === "radio" || q.type === "checkbox" || q.type === "dropdown") {
      v = q.options[0];
    } else if (q.type === "short" || q.type === "paragraph") {
      v = "أ";
    } else if (q.type === "date") {
      v = `${yyyy}-${mm}-${dd}`;
    } else if (q.type === "time") {
      v = "12:00";
    } else if (q.type === "scale") {
      v = q.options[Math.floor(q.options.length / 2)] ?? q.options[0];
    }
    if (v) {
      params.append(`entry.${q.entryId}`, v);
      n++;
    }
  }
  if (!n) return null;
  const base = form.sourceUrl.split("?")[0];
  return `${base}?${params.toString()}`;
}
