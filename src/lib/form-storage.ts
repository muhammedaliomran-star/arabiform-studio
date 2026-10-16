import type { FormDoc, FormResponse, Store } from "./form-types";
import { isAnswerable, uid } from "./form-types";

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
    isQuiz: raw.isQuiz,
    headerImage: raw.headerImage,
    theme: raw.theme,
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
  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const slim = {
    title: form.title,
    description: form.description,
    isQuiz: !!form.isQuiz,
    headerImage: form.headerImage || "",
    theme: form.theme || null,
    questions: form.questions.map((q) => ({
      title: q.title,
      description: q.description,
      type: q.type,
      required: q.required,
      options: q.options,
      max: q.max,
      images: q.images || [],
      hasImage: !!q.image,
      points: q.points || 0,
      correct: q.correct || [],
      validation: q.validation
        ? {
            op: q.validation.op,
            args: q.validation.args.map(escRe),
            message: q.validation.message || "",
          }
        : null,
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
//    (إن كان النموذج فيه صور سيطلب إذن Drive أيضاً — اسمح به)
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
  if (data.isQuiz && gf.setIsQuiz) gf.setIsQuiz(true);

  var created = 0;
  var skipped = 0;
  var noKey = 0;

  // قراءة صورة من Drive ID (تتطلب إذن Drive عند التشغيل)
  function imageBlob(src) {
    try {
      if (typeof DriveApp !== "undefined") return DriveApp.getFileById(src).getBlob();
    } catch (e) {
      Logger.log("تعذر قراءة صورة Drive: " + src);
    }
    return null;
  }

  // صورة ترويسة النموذج (تُضاف كأول عنصر لأن FormApp لا يدعم ترويسة مباشرة)
  if (data.headerImage) {
    try {
      var hb = imageBlob(data.headerImage);
      if (hb) {
        var hi = gf.addImageItem();
        hi.setImage(hb);
        if (hi.setTitle) hi.setTitle(data.title || "صورة");
      } else {
        throw "blob فارغ";
      }
    } catch (herr) {
      Logger.log("تعذر إضافة صورة الترويسة — أضفها يدوياً من: https://drive.google.com/file/d/" + data.headerImage + "/view");
    }
  }
  for (var qi = 0; qi < data.questions.length; qi++) {
    var q = data.questions[qi];
    try {
      var title = (q.title || "").trim() || q.description || "سؤال بدون عنوان";
      var opts = (q.options || []).filter(function (o) { return o && String(o).trim() !== ""; });
      var imgNote = "";
      // صور السؤال (تُضاف قبل السؤال نفسه حتى تظهر فوقه)
      var qimgs = q.images || [];
      for (var ii = 0; ii < qimgs.length; ii++) {
        try {
          var ib = imageBlob(qimgs[ii]);
          if (ib) {
            var im = gf.addImageItem();
            im.setImage(ib);
            if (im.setTitle) im.setTitle(title);
          } else {
            imgNote += " [صورة: https://drive.google.com/file/d/" + qimgs[ii] + "/view]";
          }
        } catch (ie) {
          imgNote += " [تعذر إرفاق صورة — انسخها يدوياً من محرر Google Forms]";
          Logger.log("تعذر إرفاق صورة للسؤال: " + title);
        }
      }
      if (q.hasImage) {
        imgNote += " [ملاحظة: أضف صورة السؤال المرفوعة يدوياً من محرر Google Forms]";
      }
      var item = null;
      switch (q.type) {
        case "short":
          item = gf.addTextItem();
          if (data.isQuiz && q.points > 0 && item.setPoints) item.setPoints(q.points);
          break;
        case "paragraph":
          item = gf.addParagraphTextItem();
          if (data.isQuiz && q.points > 0 && item.setPoints) item.setPoints(q.points);
          break;
        case "radio": {
          var rItem = gf.addMultipleChoiceItem();
          var rQuiz = false;
          if (data.isQuiz && q.correct && q.correct.length) {
            try {
              var rChoices = [];
              for (var ci = 0; ci < opts.length; ci++) {
                var isC = false;
                for (var cj = 0; cj < q.correct.length; cj++) {
                  if (String(q.correct[cj]).trim() === String(opts[ci]).trim()) { isC = true; break; }
                }
                rChoices.push(rItem.createChoice(opts[ci], isC));
              }
              rItem.setChoices(rChoices);
              rQuiz = true;
            } catch (qe) {
              Logger.log("تعذر وضع الإجابة الصحيحة (اختيار من متعدد): " + title);
            }
          }
          if (!rQuiz) {
            if (opts.length) rItem.setChoiceValues(opts);
            else rItem.setChoiceValues(["خيار 1", "خيار 2"]);
          }
          if (data.isQuiz && q.points > 0 && rItem.setPoints) rItem.setPoints(q.points);
          item = rItem;
          if (rQuiz) Logger.log("مفتاح الإجابة [" + title + "]: " + q.correct.join("، "));
          break;
        }
        case "checkbox": {
          var cItem = gf.addCheckboxItem();
          var cQuiz = false;
          if (data.isQuiz && q.correct && q.correct.length) {
            try {
              var cChoices = [];
              for (var ki = 0; ki < opts.length; ki++) {
                var isCk = false;
                for (var kj = 0; kj < q.correct.length; kj++) {
                  if (String(q.correct[kj]).trim() === String(opts[ki]).trim()) { isCk = true; break; }
                }
                cChoices.push(cItem.createChoice(opts[ki], isCk));
              }
              cItem.setChoices(cChoices);
              cQuiz = true;
            } catch (qe2) {
              Logger.log("تعذر وضع الإجابات الصحيحة (مربعات): " + title);
            }
          }
          if (!cQuiz) {
            if (opts.length) cItem.setChoiceValues(opts);
            else cItem.setChoiceValues(["خيار 1", "خيار 2"]);
          }
          if (data.isQuiz && q.points > 0 && cItem.setPoints) cItem.setPoints(q.points);
          item = cItem;
          if (cQuiz) Logger.log("مفتاح الإجابة [" + title + "]: " + q.correct.join("، "));
          break;
        }
        case "dropdown": {
          var lItem = gf.addListItem();
          var lQuiz = false;
          if (data.isQuiz && q.correct && q.correct.length && opts.length) {
            try {
              var lChoices = [];
              for (var li = 0; li < opts.length; li++) {
                var isL = false;
                for (var lj = 0; lj < q.correct.length; lj++) {
                  if (String(q.correct[lj]).trim() === String(opts[li]).trim()) { isL = true; break; }
                }
                lChoices.push(lItem.createChoice(opts[li], isL));
              }
              lItem.setChoices(lChoices);
              lQuiz = true;
            } catch (qe3) {
              Logger.log("تعذر وضع الإجابة الصحيحة (قائمة منسدلة): " + title);
            }
          }
          if (!lQuiz) {
            if (opts.length) lItem.setChoiceValues(opts);
            else lItem.setChoiceValues(["خيار 1", "خيار 2"]);
          }
          item = lItem;
          if (lQuiz) Logger.log("مفتاح الإجابة [" + title + "]: " + q.correct.join("، "));
          break;
        }
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
        case "text":
          // نص وصفي (قطع القراءة والعناوين) — بدون إجابة
          item = gf.addSectionHeaderItem();
          break;
        case "image": {
          // صورة مستقلة بدون سؤال
          var firstImg = null;
          var imgList = q.images || [];
          for (var mi = 0; mi < imgList.length; mi++) {
            try {
              var mb = imageBlob(imgList[mi]);
              if (mb) {
                var mItem = gf.addImageItem();
                mItem.setImage(mb);
                if (!firstImg) firstImg = mItem;
              }
            } catch (me) {
              Logger.log("تعذر إرفاق صورة مستقلة");
            }
          }
          item = firstImg || gf.addSectionHeaderItem();
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
      // قاعدة التحقق النصية (op=4 تعني "يحتوي على")
      if ((q.type === "short" || q.type === "paragraph") && q.validation && q.validation.op === 4 && q.validation.args && q.validation.args.length) {
        try {
          if (gf.createTextValidation) {
            var tv = gf.createTextValidation().requireTextContainsPattern(q.validation.args[0]);
            if (q.validation.message && tv.setHelpText) tv.setHelpText(q.validation.message);
            if (item.setValidation) item.setValidation(tv);
          }
        } catch (ve) {
          Logger.log("تعذر نسخ قاعدة التحقق للسؤال: " + title);
        }
      }
      if (q.description && typeof item.setHelpText === "function") {
        var prev = typeof item.getHelpText === "function" ? item.getHelpText() : "";
        var help = prev ? prev + "\\n" + q.description : q.description;
        if (imgNote) help += "\\n" + imgNote;
        item.setHelpText(help);
      } else if (imgNote && typeof item.setHelpText === "function") {
        item.setHelpText(imgNote);
      }
      if (q.type !== "section" && item.setRequired) item.setRequired(!!q.required);
      if (data.isQuiz && (q.type === "radio" || q.type === "checkbox" || q.type === "dropdown") && (!q.correct || !q.correct.length)) {
        noKey++;
        Logger.log("بلا مفتاح إجابة: " + title);
      }
      created++;
    } catch (err) {
      skipped++;
      Logger.log("تُخطّي سؤال بسبب خطأ: " + (q && q.title) + " — " + err);
    }
  }

  Logger.log("تم إنشاء " + created + " سؤال" + (skipped ? " (تُخطّي " + skipped + ")" : "") + (noKey ? " — تنبيه: " + noKey + " سؤال بلا مفتاح إجابة" : ""));
  Logger.log("رابط التحرير: " + gf.getEditUrl());
  Logger.log("رابط التعبئة: " + gf.getPublishedUrl());
  if (data.theme && data.theme.accent) {
    Logger.log("هوية النموذج الأصلي — اللون الأساسي: " + data.theme.accent + " | الخلفية: " + data.theme.background + " | الخط: " + data.theme.font);
    Logger.log("لطبّقها: افتح النموذج ← أيقونة الألوان 🎨 ← لون مخصص والصق الكود ← الخط من قائمة الخطوط");
  }
}
`;
  download(`${safeName(form.title)}-google-forms.gs`, script, "text/plain;charset=utf-8");
}

/* ---------- responses export ---------- */

function csvCell(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}

export function responsesToCsv(form: FormDoc, responses: FormResponse[]) {
  const cols = form.questions.filter(isAnswerable);
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
    z: !!form.isQuiz,
    h: form.headerImage || "",
    th: form.theme,
    q: form.questions.map((q) => ({ ...q, image: undefined })),
  };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(slim)));
}

export function decodeForm(code: string): FormDoc {
  const slim = JSON.parse(new TextDecoder().decode(fromBase64Url(code))) as {
    t: string;
    d: string;
    z?: boolean;
    h?: string;
    th?: FormDoc["theme"];
    q: FormDoc["questions"];
  };
  return {
    id: uid(),
    title: slim.t,
    description: slim.d ?? "",
    isQuiz: slim.z,
    headerImage: slim.h || undefined,
    theme: slim.th,
    questions: slim.q ?? [],
    updatedAt: Date.now(),
  };
}
