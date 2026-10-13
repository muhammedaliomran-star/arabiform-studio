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
