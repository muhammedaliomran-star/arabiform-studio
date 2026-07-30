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
  | "section";

export type Question = {
  id: string;
  title: string;
  description: string;
  type: QType | "unknown";
  required: boolean;
  options: string[];
  /** data URL for an optional question image */
  image?: string;
  /** option value -> target section question id, or "__end" to jump to submit */
  goTo?: Record<string, string>;
  /** max stars for the rating type */
  max?: number;
};

export type FormDoc = {
  id: string;
  title: string;
  description: string;
  sourceUrl?: string;
  questions: Question[];
  updatedAt: number;
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
};

export const OPTION_TYPES: QType[] = ["radio", "checkbox", "dropdown", "scale"];

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newQuestion(type: QType = "short"): Question {
  return {
    id: uid(),
    title: type === "section" ? "قسم جديد" : "سؤال جديد",
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
