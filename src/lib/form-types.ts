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
