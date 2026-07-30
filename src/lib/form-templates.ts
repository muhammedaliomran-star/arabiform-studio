import type { Question } from "./form-types";
import { uid } from "./form-types";

type Template = { key: string; label: string; title: string; description: string; questions: Omit<Question, "id">[] };

export const TEMPLATES: Template[] = [
  {
    key: "satisfaction",
    label: "استبيان رضا العملاء",
    title: "استبيان رضا العملاء",
    description: "رأيك يساعدنا على التحسين — لن يستغرق الأمر أكثر من دقيقة.",
    questions: [
      { title: "ما اسمك؟", description: "", type: "short", required: false, options: [] },
      { title: "كيف تقيّم تجربتك معنا؟", description: "", type: "rating", required: true, options: [], max: 5 },
      {
        title: "ما الخدمة التي استخدمتها؟",
        description: "",
        type: "radio",
        required: true,
        options: ["الدعم الفني", "المبيعات", "التوصيل", "أخرى"],
      },
      { title: "اقتراحاتك لتحسين الخدمة", description: "", type: "paragraph", required: false, options: [] },
    ],
  },
  {
    key: "event",
    label: "تسجيل حضور فعالية",
    title: "تسجيل حضور فعالية",
    description: "سجّل حضورك قبل انتهاء المقاعد.",
    questions: [
      { title: "الاسم الكامل", description: "", type: "short", required: true, options: [] },
      { title: "البريد الإلكتروني", description: "", type: "short", required: true, options: [] },
      { title: "تاريخ الحضور المفضل", description: "", type: "date", required: true, options: [] },
      {
        title: "الجلسات التي تودّ حضورها",
        description: "يمكنك اختيار أكثر من جلسة",
        type: "checkbox",
        required: false,
        options: ["الافتتاح", "ورشة التصميم", "ورشة البرمجة", "حفل الختام"],
      },
    ],
  },
  {
    key: "contact",
    label: "نموذج تواصل بسيط",
    title: "تواصل معنا",
    description: "اترك رسالتك وسنعود إليك خلال يوم عمل.",
    questions: [
      { title: "الاسم", description: "", type: "short", required: true, options: [] },
      { title: "رقم الجوال", description: "", type: "short", required: false, options: [] },
      {
        title: "موضوع الرسالة",
        description: "",
        type: "dropdown",
        required: true,
        options: ["استفسار", "شكوى", "اقتراح", "شراكة"],
      },
      { title: "الرسالة", description: "", type: "paragraph", required: true, options: [] },
    ],
  },
];

export function templateToForm(t: Template) {
  return {
    id: uid(),
    title: t.title,
    description: t.description,
    updatedAt: Date.now(),
    questions: t.questions.map((q) => ({ ...q, id: uid() })),
  };
}
