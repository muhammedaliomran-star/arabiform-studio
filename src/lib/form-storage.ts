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

/** Encode UTF-8 bytes as base64 (chunked to avoid call-stack limits). */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

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
  // البيانات تُضمَّن مشفَّرة بـ base64 (حروف وأرقام فقط) حتى لا يكسر أي محرف
  // عربي أو رمز خاص أو سطر جديد بنيةَ الكود — حل لمشكلة "Invalid or unexpected token".
  const b64 = utf8ToBase64(JSON.stringify(slim));
  // تُقسَّم على أسطر قصيرة (180 حرف) حتى لا يتأثر اللصق بسطر واحد عملاق.
  const b64Lines: string[] = [];
  for (let i = 0; i < b64.length; i += 180) b64Lines.push(b64.slice(i, i + 180));
  const b64Array = b64Lines.map((c) => `"${c}"`).join(",\n");
  const script = `// أنشأ هذا الملف تلقائياً من تطبيق "استنساخ"
// خطوات التشغيل في script.google.com:
// 1) الصق هذا الكود كاملاً (امسح أي كود قديم مثل myFunction)
// 2) اختر الدالة buildForm من القائمة المنسدلة فوق زر التشغيل ثم اضغط "تشغيل"
// 3) أول مرة سيطلب إذن الوصول — اضغط "مراجعة الأذونات" واسمح لحسابك
// 4) بعد التشغيل افتح سجل التنفيذ (Execution log) وستجد رابطي التحرير والتعبئة
// بيانات النموذج: base64 مقسمة على أسطر قصيرة (حروف وأرقام فقط — لا تكسر الكود)
var DATA_B64 = [
${b64Array}
].join("");
function myFunction() {
  buildForm();
}
function buildForm() {
  var data = JSON.parse(
    Utilities.newBlob(Utilities.base64Decode(DATA_B64)).getDataAsString("UTF-8")
  );
  var gf = FormApp.create(data.title || "نموذج");
  if (data.description) gf.setDescription(data.description);

  var created = 0;
  var skipped = 0;
  for (var qi = 0; qi < data.questions.length; qi++) {
    var q = data.questions[qi];
    try {
      var title = (q.title || "").trim() || q.description || "سؤال بدون عنوان";
      var opts = (q.options || []).filter(function (o) { return o && String(o).trim() !== ""; });
      var item = null;
      switch (q.type) {
        case "short":
          item = gf.addTextItem(); break;
        case "paragraph":
          item = gf.addParagraphTextItem(); break;
        case "radio":
          item = opts.length
            ? gf.addMultipleChoiceItem().setChoiceValues(opts)
            : gf.addMultipleChoiceItem().setChoiceValues(["خيار 1", "خيار 2"]);
          break;
        case "checkbox":
          item = opts.length
            ? gf.addCheckboxItem().setChoiceValues(opts)
            : gf.addCheckboxItem().setChoiceValues(["خيار 1", "خيار 2"]);
          break;
        case "dropdown":
          item = opts.length
            ? gf.addListItem().setChoiceValues(opts)
            : gf.addListItem().setChoiceValues(["خيار 1", "خيار 2"]);
          break;
        case "scale": {
          var labels = opts.length >= 2 ? opts : null;
          var sc = gf.addScaleItem().setBounds(1, Math.max(2, opts.length || 5));
          if (labels) sc.setLabels(labels[0], labels[labels.length - 1]);
          item = sc;
          break;
        }
        case "date":
          item = gf.addDateItem(); break;
        case "time":
          item = gf.addTimeItem(); break;
        case "rating": {
          var sc2 = gf.addScaleItem().setBounds(1, Math.max(2, q.max || 5));
          item = sc2;
          break;
        }
        case "section": {
          var pb = gf.addPageBreakItem();
          pb.setTitle(title);
          item = pb;
          break;
        }
        case "unknown":
          // عناوين الأقسام والنصوص الوصفية (بدون خيارات) تتحول لعنوان قسم،
          // ولو فيها خيارات تتحول لاختيار من متعدد.
          if (opts.length) {
            item = gf.addMultipleChoiceItem().setChoiceValues(opts);
          } else {
            item = gf.addSectionHeaderItem();
          }
          break;
        default:
          // signature/file لا يدعمها Google Forms عبر السكربت → نحوّلها لسؤال نصي مع تنبيه
          item = gf.addTextItem();
          if (q.type === "file" || q.type === "signature") {
            item.setHelpText("ملاحظة: أضف حقل رفع الملف/التوقيع يدوياً من محرر Google Forms.");
          }
      }
      item.setTitle(title);
      if (q.description && typeof item.setHelpText === "function") {
        var prev = typeof item.getHelpText === "function" ? item.getHelpText() : "";
        item.setHelpText(prev ? prev + "\\n" + q.description : q.description);
      }
      if (q.type !== "section" && item.setRequired) item.setRequired(!!q.required);
      created++;
    } catch (err) {
      skipped++;
      Logger.log("تُخطّي سؤال بسبب خطأ: " + (q && q.title) + " — " + err);
    }
  }

  Logger.log("تم إنشاء " + created + " سؤال" + (skipped ? " (تُخطّي " + skipped + ")" : ""));
  Logger.log("رابط التحرير: " + gf.getEditUrl());
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
