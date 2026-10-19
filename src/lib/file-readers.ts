/** قراءة ملف نصي (txt) من المتصفح دون رفعه لأي جهة. */
export async function readTextFile(file: File): Promise<string> {
  const text = await file.text();
  return text;
}

/** التحقق من امتداد الملف المدعوم للتحليل النصي. */
export function isSupportedTextFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".txt") || name.endsWith(".md");
}

/** ملحقات تحتاج تحويلاً خارجياً قبل الاستيراد (لا يمكن قراءتها مباشرة في المتصفح بدون مكتبة خارجية). */
export const REQUIRES_CONVERSION = [".doc", ".docx", ".pdf", ".rtf"];

/** رسالة توجيه للمستخدم عند اختيار ملف غير مدعوم القراءة مباشرة. */
export function conversionHint(file: File): string {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (REQUIRES_CONVERSION.includes(ext)) {
    return `الملف "${file.name}" من نوع ${ext.toUpperCase()} لا يمكن قراءته مباشرة في المتصفح بدون مكتبة خارجية.
الرجاء أحد الخيارين:
1. افتح الملف في وورد/بي دي إف → احفظه كـ "نص عادي (.txt)" ثم استيرده من هنا.
2. انسخ محتوى الملف والصقه في مربع النص أدناه واستورد من النص مباشرة.`;
  }
  return `نوع الملف "${ext}" غير مدعوم للاستيراد النصي.`;
}
