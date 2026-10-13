import type { FormDoc, FormResponse, Store } from "./form-types";
import { uid } from "./form-types";

export const STORAGE_KEY = "istinsakh:v1";
export const THEME_KEY = "istinsakh:theme";

export function loadStore(): Store {
  if (typeof window === "undefined") return { forms: [], responses: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { forms: [], responses: {} };
    const parsed = JSON.parse(raw) as Store;
    return { forms: parsed.forms ?? [], responses: parsed.responses ?? {} };
  } catch {
    return { forms: [], responses: {} };
  }
}

export function saveStore(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded — keep the in-memory state usable */
  }
}

export function download(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => (s || "form").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);

export function exportFormJson(form: FormDoc) {
  const payload = { kind: "istinsakh.form", version: 1, form };
  download(`${safeName(form.title)}.json`, JSON.stringify(payload, null, 2), "application/json");
}

export function parseFormJson(text: string): FormDoc {
  const data = JSON.parse(text) as { form?: FormDoc } & Partial<FormDoc>;
  const raw = data.form ?? (data as FormDoc);
  if (!raw || !Array.isArray(raw.questions)) throw new Error("ملف غير صالح: لا يحتوي على أسئلة.");
  return {
    id: uid(),
    title: raw.title || "نموذج مستورد",
    description: raw.description ?? "",
    sourceUrl: raw.sourceUrl,
    updatedAt: Date.now(),
    questions: raw.questions.map((q) => ({
      ...q,
      id: uid(),
      options: Array.isArray(q.options) ? q.options : [],
      required: Boolean(q.required),
      description: q.description ?? "",
    })),
  };
}

/* ---------- Google Forms export (Apps Script generator) ---------- */

export function exportAppsScript(form: FormDoc) {
  const slim = {
    title: form.title,
    description: form.description,
    questions: form.questions.map((q) => ({
      title: q.title,
      description: q.description,
      type: q.type,
      required: q.required,
      options: q.options,
      max: q.max,
    })),
  };
  const json = JSON.stringify(slim)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
  const script = `// أنشأ هذا الملف تلقائياً من تطبيق "استنساخ"
// الخطوات: الصق هذا الكود في script.google.com ثم اضغط تشغيل على buildForm
function buildForm() {
  const data = JSON.parse(\`${json}\`);
  const gf = FormApp.create(data.title || "نموذج");
  if (data.description) gf.setDescription(data.description);

  for (const q of data.questions) {
    let item = null;
    switch (q.type) {
      case "short":
        item = gf.addTextItem(); break;
      case "paragraph":
        item = gf.addParagraphTextItem(); break;
      case "radio":
        item = gf.addMultipleChoiceItem().setChoiceValues(q.options); break;
      case "checkbox":
        item = gf.addCheckboxItem().setChoiceValues(q.options); break;
      case "dropdown":
        item = gf.addListItem().setChoiceValues(q.options); break;
      case "scale":
        item = gf.addScaleItem().setBounds(1, Math.max(2, q.options.length || 5)); break;
      case "date":
        item = gf.addDateItem(); break;
      case "time":
        item = gf.addTimeItem(); break;
      case "section":
        item = gf.addPageBreakItem(); break;
      default:
        item = gf.addTextItem(); // rating/signature/file → إجابة قصيرة
    }
    item.setTitle(q.title || "سؤال");
    if (q.description && item.setHelpText) item.setHelpText(q.description);
    if (q.type !== "section" && item.setRequired) item.setRequired(!!q.required);
  }

  Logger.log("تم إنشاء النموذج: " + gf.getEditUrl());
  Logger.log("رابط التعبئة: " + gf.getPublishedUrl());
}
`;
  download(`${safeName(form.title)}-google-forms.gs`, script, "text/plain;charset=utf-8");
}

/* ---------- responses export ---------- */

function csvCell(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}

export function responsesToCsv(form: FormDoc, responses: FormResponse[]) {
  const cols = form.questions.filter((q) => q.type !== "section");
  const header = ["#", "التاريخ", ...cols.map((q) => q.title || "بدون عنوان")];
  const rows = responses.map((r, i) => {
    const cells = cols.map((q) => {
      const v = r.answers[q.id];
      if (Array.isArray(v)) return v.join(" | ");
      if (typeof v === "string" && v.startsWith("data:")) return "[ملف]";
      return v ?? "";
    });
    return [String(i + 1), new Date(r.submittedAt).toLocaleString("ar-EG"), ...cells];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function exportResponsesCsv(form: FormDoc, responses: FormResponse[]) {
  // BOM so Excel opens Arabic text correctly
  download(
    `${safeName(form.title)}-responses.csv`,
    "\uFEFF" + responsesToCsv(form, responses),
    "text/csv;charset=utf-8",
  );
}

export function exportResponsesJson(form: FormDoc, responses: FormResponse[]) {
  download(
    `${safeName(form.title)}-responses.json`,
    JSON.stringify(responses, null, 2),
    "application/json",
  );
}

/* ---------- share links (no server, everything lives in the URL) ---------- */

function toBase64Url(bytes: Uint8Array) {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeForm(form: FormDoc) {
  const slim = {
    t: form.title,
    d: form.description,
    q: form.questions.map((q) => ({ ...q, image: undefined })),
  };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(slim)));
}

export function decodeForm(code: string): FormDoc {
  const slim = JSON.parse(new TextDecoder().decode(fromBase64Url(code))) as {
    t: string;
    d: string;
    q: FormDoc["questions"];
  };
  return {
    id: uid(),
    title: slim.t,
    description: slim.d ?? "",
    questions: slim.q ?? [],
    updatedAt: Date.now(),
  };
}
