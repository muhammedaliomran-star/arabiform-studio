import type { FormDoc, FormResponse, Store } from "./form-types";
import { isAnswerable, uid } from "./form-types";
import { MAX_TOTAL_UPLOAD_CHARS, MAX_UPLOAD_CHARS } from "./image-compress";

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
  // الصور المرفوعة من الجهاز تُضمَّن فقط إن كانت صغيرة (data URL) وبسقف إجمالي
  // حتى لا يتضخم ملف السكربت — الكبيرة تُترك للعرض مع تنبيه.
  // (الثوابت مستوردة من image-compress لتتوافق مع حد التنبيه في المحرر)
  let usedChars = 0;
  const slim = {
    title: form.title,
    description: form.description,
    isQuiz: !!form.isQuiz,
    headerImage: form.headerImage || "",
    theme: form.theme || null,
    questions: form.questions.map((q) => {
      let upload = "";
      let uploadTooBig = false;
      if (q.image && q.image.startsWith("data:")) {
        if (q.image.length <= MAX_UPLOAD_CHARS && usedChars + q.image.length <= MAX_TOTAL_UPLOAD_CHARS) {
          upload = q.image;
          usedChars += q.image.length;
        } else {
          uploadTooBig = true;
        }
      }
      return {
        title: q.title,
        description: q.description,
        type: q.type,
        required: q.required,
        options: q.options,
        max: q.max,
        images: q.images || [],
        hasImage: !!q.image && !upload && !uploadTooBig,
        upload,
        uploadTooBig,
        points: q.points || 0,
        correct: q.correct || [],
        validation: q.validation
          ? {
              op: q.validation.op,
              args: q.validation.args.map(escRe),
              message: q.validation.message || "",
            }
          : null,
      };
    }),
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
// 4) الصور تُجلب تلقائياً من روابطها العامة (لا نسخ يدوي) — النتيجة في سطر "الصور المرفقة"
// 5) بعد التشغيل افتح سجل التنفيذ (Execution log) وستجد رابطي التحرير والتعبئة
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

  // قراءة صورة من Drive ID بثلاث محاولات متدرجة (بدون نسخ يدوي):
  // 1) الرابط العام المباشر — يعمل متى كانت الصورة ظاهرة في النموذج الأصلي
  // 2) نفس الرابط بتوكن المستخدم — للصور المشاركة معه دون العموم
  // 3) DriveApp كاحتياط أخير (يُبقي إذن Drive مطلوباً لهذه الحالة فقط)
  // القبول فقط لنوع image/* — صفحات تسجيل الدخول (text/html) تُرفض
  var imgOk = 0;
  var imgFail = 0;
  var untitled = 0;
  function isImageBlob(b, r) {
    if (!b) return false;
    try {
      var ct = "";
      if (r && r.getHeaders) {
        var hs = r.getHeaders();
        ct = String(hs["Content-Type"] || hs["content-type"] || "");
      }
      if (ct && ct.toLowerCase().indexOf("image/") !== 0) return false;
      var bytes = b.getBytes();
      if (!bytes || bytes.length < 1000) return false;
      return true;
    } catch (e0) {
      return false;
    }
  }
  function imageBlob(src) {
    var u = "https://lh3.googleusercontent.com/d/" + src;
    try {
      var r1 = UrlFetchApp.fetch(u, { muteHttpExceptions: true });
      var b1 = r1.getResponseCode() === 200 ? r1.getBlob() : null;
      if (isImageBlob(b1, r1)) { imgOk++; return b1; }
    } catch (e1) {}
    try {
      var tok = ScriptApp.getOAuthToken();
      var r2 = UrlFetchApp.fetch(u, {
        headers: { Authorization: "Bearer " + tok },
        muteHttpExceptions: true,
      });
      var b2 = r2.getResponseCode() === 200 ? r2.getBlob() : null;
      if (isImageBlob(b2, r2)) { imgOk++; return b2; }
    } catch (e2) {}
    try {
      if (typeof DriveApp !== "undefined") {
        var b3 = DriveApp.getFileById(src).getBlob();
        var ct3 = String((b3.getContentType && b3.getContentType()) || "");
        if (ct3.toLowerCase().indexOf("image/") === 0) { imgOk++; return b3; }
      }
    } catch (e3) {
      Logger.log("تعذر قراءة صورة Drive: " + src);
    }
    imgFail++;
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
      var rawTitle = (q.title || "").trim();
      if (!rawTitle && !(q.description || "").trim()) {
        untitled++;
        rawTitle = "سؤال " + untitled;
      }
      var title = rawTitle || (q.description || "").trim() || "سؤال بدون عنوان";
      var opts = (q.options || []).filter(function (o) { return o && String(o).trim() !== ""; });
      var imgNote = "";
      // صورة مرفوعة من الجهاز (مضمّنة ومضغوطة مسبقاً) — تُزرع مباشرة
      if (q.upload && q.upload.indexOf("data:") === 0) {
        try {
          var uparts = q.upload.split(",");
          var umime = "image/jpeg";
          var umh = uparts[0].match(/data:([^;]+);/);
          if (umh) umime = umh[1];
          var ub = Utilities.newBlob(Utilities.base64Decode(uparts[1]), umime);
          gf.addImageItem().setImage(ub);
        } catch (ue) {
          imgNote += " [تعذر إرفاق الصورة المرفوعة — أضفها يدوياً من محرر Google Forms]";
          Logger.log("تعذر إرفاق الصورة المرفوعة للسؤال: " + title);
        }
      } else if (q.uploadTooBig) {
        imgNote += " [ملاحظة: الصورة المرفوعة كبيرة — أضفها يدوياً من محرر Google Forms]";
      }
      // صور السؤال (تُضاف قبل السؤال نفسه حتى تظهر فوقه)
      var qimgs = q.images || [];
      for (var ii = 0; ii < qimgs.length; ii++) {
        try {
          var ib = imageBlob(qimgs[ii]);
          if (ib) {
            // عنصر الصورة بلا عنوان عمداً حتى لا يُتوهم سؤالاً مستقلاً في المحرر
            gf.addImageItem().setImage(ib);
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
      // النص الوصفي/وصف السؤال: أقسام Google Forms تدعم setDescription، والأسئلة setHelpText
      if (q.description) {
        var help = q.description;
        if (imgNote) help += "\\n" + imgNote;
        try {
          if (typeof item.setDescription === "function") {
            item.setDescription(help);
          } else if (typeof item.setHelpText === "function") {
            var prev = typeof item.getHelpText === "function" ? item.getHelpText() : "";
            item.setHelpText(prev ? prev + "\\n" + help : help);
          }
        } catch (de) {
          Logger.log("تعذر حفظ الوصف للسؤال: " + title);
        }
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
  Logger.log("الصور المرفقة تلقائياً: " + imgOk + (imgFail ? " (تعذر " + imgFail + " — انسخها يدوياً من محرر Google Forms)" : ""));
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

/* ---------- Google Forms export (REST mode: image INSIDE the question) ----------
   FormApp cannot attach images to questions; the REST API can
   (questionItem.image.sourceUri) with grading in the same item.
   Requires one-time manifest scope: https://www.googleapis.com/auth/forms.body */

export function exportRestScript(form: FormDoc) {
  const MAX_UPLOAD_CHARS = 350000;
  const MAX_TOTAL_CHARS = 2500000;
  let usedChars = 0;
  const slim = {
    title: form.title,
    description: form.description,
    isQuiz: !!form.isQuiz,
    questions: form.questions.map((q) => {
      let upload = "";
      let uploadTooBig = false;
      if (q.image && q.image.startsWith("data:")) {
        if (q.image.length <= MAX_UPLOAD_CHARS && usedChars + q.image.length <= MAX_TOTAL_CHARS) {
          upload = q.image;
          usedChars += q.image.length;
        } else {
          uploadTooBig = true;
        }
      }
      return {
        title: q.title,
        description: q.description,
        type: q.type,
        required: q.required,
        options: q.options,
        max: q.max,
        images: q.images || [],
        upload,
        uploadTooBig,
        points: q.points || 0,
        correct: q.correct || [],
      };
    }),
  };
  const b64 = utf8ToBase64(JSON.stringify(slim));
  const b64Lines: string[] = [];
  for (let i = 0; i < b64.length; i += 180) b64Lines.push(b64.slice(i, i + 180));
  const b64Array = b64Lines.map((c) => `"${c}"`).join(",\n");
  const script = `// تصدير "بلوك موحد (تجريبي)" من تطبيق "استنساخ" — الصورة داخل بطاقة السؤال + المفتاح + الدرجة
// ============ خطوة واحدة إجبارية قبل أول تشغيل (دقيقتان، مرة واحدة فقط) ============
// في محرر السكربت: ⚙ إعدادات المشروع ← فعّل "إظهار ملف Manifest (appsscript.json)"
// افتح appsscript.json وأضف هذا السطر داخل القوسين (مع الاحتفاظ بأي سطور موجودة):
//   "oauthScopes": [
//     "https://www.googleapis.com/auth/forms",
//     "https://www.googleapis.com/auth/forms.body",
//     "https://www.googleapis.com/auth/drive",
//     "https://www.googleapis.com/auth/script.external_request"
//   ]
// ثم شغّل buildFormRest. عند أول تشغيل اسمح بكل الأذونات.
// لو ظهر خطأ Forms API غير مفعّلة: فعّلها من https://console.cloud.google.com/apis/library/forms.googleapis.com
// ============ التشغيل ============
// اختر الدالة buildFormRest ثم اضغط "تشغيل". تابع سجل التنفيذ سطراً سطراً.
// ملاحظة: الصور الخاصة بصاحب النموذج (تسجيل دخول) تُتخطى تلقائياً مع تنبيه — استبدلها من موقعنا قبل التصدير.
var DATA_B64 = [
${b64Array}
].join("");
function myFunction() {
  buildFormRest();
}
function buildFormRest() {
  var data = JSON.parse(
    Utilities.newBlob(Utilities.base64Decode(DATA_B64)).getDataAsString("UTF-8")
  );
  var token = ScriptApp.getOAuthToken();
  var API = "https://forms.googleapis.com/v1/";

  function safeParse(t) { try { return JSON.parse(t); } catch (e) { return null; } }
  function rest(method, path, body) {
    var params = {
      method: method,
      headers: { Authorization: "Bearer " + token },
      contentType: "application/json",
      muteHttpExceptions: true,
    };
    if (body) params.payload = JSON.stringify(body);
    var r = UrlFetchApp.fetch(API + path, params);
    return { code: r.getResponseCode(), text: r.getContentText(), json: safeParse(r.getContentText()) };
  }
  function needScopeStop(res) {
    var t = String((res && res.text) || "");
    if (res && (res.code === 401 || res.code === 403) && t.indexOf("insufficient authentication scopes") >= 0) {
      Logger.log("تنبيه صلاحية: أضف سطر forms.body في appsscript.json كما في أول الملف ثم أعد التشغيل.");
      return true;
    }
    if (res && res.code === 403 && t.indexOf("has not been used") >= 0) {
      Logger.log("فعّل Forms API من: https://console.cloud.google.com/apis/library/forms.googleapis.com ثم أعد التشغيل.");
      return true;
    }
    return false;
  }

  // 1) إنشاء النموذج
  var cr = rest("post", "forms", { info: { title: data.title || "نموذج" } });
  if (needScopeStop(cr)) return;
  if (cr.code !== 200 || !cr.json || !cr.json.formId) {
    Logger.log("فشل إنشاء النموذج عبر REST (" + cr.code + "). استخدم التصدير العادي (FormApp) لهذا النموذج.");
    return;
  }
  var formId = cr.json.formId;
  Logger.log("تم إنشاء النموذج: https://docs.google.com/forms/d/" + formId + "/edit");

  // 2) الوصف + وضع الاختبار
  if (data.description) {
    rest("post", "forms/" + formId + ":batchUpdate", {
      requests: [{ updateFormInfo: { info: { description: data.description }, updateMask: "description" } }],
    });
  }
  if (data.isQuiz) {
    rest("post", "forms/" + formId + ":batchUpdate", {
      requests: [{ updateSettings: { settings: { quizSettings: { isQuiz: true } }, updateMask: "quizSettings.isQuiz" } }],
    });
  }

  // 3) مجلد صور المرفوعات في درايف المستخدم
  var imgFolder = null;
  function ensureFolder() {
    if (!imgFolder) imgFolder = DriveApp.createFolder("استنساخ-صور " + (data.title || "نموذج"));
    return imgFolder;
  }
  function uploadToDrive(dataUrl, name) {
    try {
      var parts = dataUrl.split(",");
      var mime = "image/jpeg";
      var mh = parts[0].match(/data:([^;]+);/);
      if (mh) mime = mh[1];
      var f = ensureFolder().createFile(Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, name));
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return "https://drive.google.com/uc?export=view&id=" + f.getId();
    } catch (e) {
      Logger.log("تعذر رفع صورة مرفوعة إلى Drive.");
      return null;
    }
  }
  function urlFetchable(u) {
    try {
      var r = UrlFetchApp.fetch(u, { muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) return false;
      var hs = r.getHeaders();
      var ct = String(hs["Content-Type"] || hs["content-type"] || "");
      return ct.toLowerCase().indexOf("image/") === 0;
    } catch (e) {
      return false;
    }
  }

  var created = 0;
  var skipped = 0;
  var noKey = 0;
  var imgOk = 0;
  var imgFail = 0;
  var loc = 0;

  function publicImgUrl(driveId) {
    var u = "https://lh3.googleusercontent.com/d/" + driveId;
    if (urlFetchable(u)) return u;
    return null;
  }

  function buildItem(q, imgUrl, withGrading) {
    var title = (q.title || "").trim() || q.description || "سؤال بدون عنوان";
    var opts = (q.options || []).filter(function (o) { return o && String(o).trim() !== ""; });
    var item = { title: title, description: q.description || "" };
    var t = q.type;
    var qi = null;
    if (t === "short") {
      qi = { question: { required: !!q.required, textQuestion: {} } };
      item.questionItem = qi;
    } else if (t === "paragraph") {
      qi = { question: { required: !!q.required, textQuestion: { paragraph: true } } };
      item.questionItem = qi;
    } else if (t === "radio" || t === "checkbox" || t === "dropdown" || (t === "unknown" && opts.length)) {
      var ctype = t === "checkbox" ? "CHECKBOX" : t === "dropdown" ? "DROP_DOWN" : "RADIO";
      var ch = {
        type: ctype,
        options: (opts.length ? opts : ["خيار 1", "خيار 2"]).map(function (o) { return { value: o }; }),
        shuffle: false,
      };
      var ques = { required: !!q.required, choiceQuestion: ch };
      if (withGrading && data.isQuiz && q.correct && q.correct.length) {
        var matched = [];
        for (var ci = 0; ci < opts.length; ci++) {
          for (var cj = 0; cj < q.correct.length; cj++) {
            if (String(q.correct[cj]).trim() === String(opts[ci]).trim()) { matched.push({ value: opts[ci] }); break; }
          }
        }
        if (matched.length) {
          ques.grading = { pointValue: q.points > 0 ? q.points : 1, correctAnswers: { answers: matched } };
        }
      } else if (withGrading && data.isQuiz && q.points > 0) {
        ques.grading = { pointValue: q.points };
      }
      qi = { question: ques };
      item.questionItem = qi;
    } else if (t === "scale" || t === "rating") {
      var high = t === "rating" ? Math.max(2, q.max || 5) : Math.max(2, opts.length || 5);
      item.questionItem = { question: { required: !!q.required, scaleQuestion: { low: 1, high: high } } };
    } else if (t === "date") {
      item.questionItem = { question: { required: !!q.required, dateQuestion: {} } };
    } else if (t === "time") {
      item.questionItem = { question: { required: !!q.required, timeQuestion: {} } };
    } else if (t === "section") {
      item.pageBreakItem = {};
    } else if (t === "text") {
      item.textItem = {};
    } else if (t === "image") {
      if (imgUrl) item.imageItem = { image: { sourceUri: imgUrl } };
      else item.textItem = {};
    } else {
      item.textItem = {};
      if (t === "file" || t === "signature") {
        item.description = (item.description ? item.description + "\\n" : "") + "ملاحظة: أضف حقل رفع الملف/التوقيع يدوياً من محرر Google Forms.";
      }
      if (t === "unknown" && !opts.length) {
        item.textItem = {};
      }
    }
    if (imgUrl && item.questionItem) {
      item.questionItem.image = { sourceUri: imgUrl };
    }
    return item;
  }

  for (var n = 0; n < data.questions.length; n++) {
    var q = data.questions[n];
    var imgUrl = null;
    var allImgs = [];
    // المرفوعات من الجهاز تُرفع لدرايفك أولاً
    if (q.upload && q.upload.indexOf("data:") === 0) {
      var up = uploadToDrive(q.upload, "q" + (n + 1) + ".jpg");
      if (up) { allImgs.push(up); imgOk++; }
      else { imgFail++; Logger.log("تعذر رفع صورة مرفوعة للسؤال: " + (q.title || ("سؤال " + (n + 1)))); }
    } else if (q.uploadTooBig) {
      imgFail++;
      Logger.log("صورة مرفوعة كبيرة تُخطّت (أضفها يدوياً): " + (q.title || ("سؤال " + (n + 1))));
    }
    // صور Drive IDs العامة
    var driveImgs = q.images || [];
    for (var di = 0; di < driveImgs.length; di++) {
      var du = publicImgUrl(driveImgs[di]);
      if (du) { allImgs.push(du); imgOk++; }
      else { imgFail++; Logger.log("تعذر الوصول لصورة (خاصة على الأرجح): " + driveImgs[di]); }
    }
    if (allImgs.length) imgUrl = allImgs[0];
    if (allImgs.length > 1) {
      Logger.log("ملاحظة: سؤال له أكثر من صورة — أُدرجت الأولى داخل السؤال: " + (q.title || ("سؤال " + (n + 1))));
    }

    var attempts = [
      { img: imgUrl, grade: true },
      { img: null, grade: true },
      { img: null, grade: false },
    ];
    var done = false;
    for (var a = 0; a < attempts.length && !done; a++) {
      try {
        var body = {
          requests: [{ createItem: { item: buildItem(q, attempts[a].img, attempts[a].grade), location: { index: loc } } }],
        };
        var rr = rest("post", "forms/" + formId + ":batchUpdate", body);
        if (rr.code === 200) {
          done = true;
          loc++;
          created++;
          var tt = ((q.title || "").trim() || "سؤال " + (n + 1));
          if (data.isQuiz && (q.type === "radio" || q.type === "checkbox" || q.type === "dropdown") && attempts[a].grade && q.correct && q.correct.length) {
            Logger.log("مفتاح الإجابة [" + tt + "]: " + q.correct.join("، "));
          }
          if (data.isQuiz && (q.type === "radio" || q.type === "checkbox" || q.type === "dropdown") && (!q.correct || !q.correct.length)) {
            noKey++;
          }
        } else if (needScopeStop(rr)) {
          return;
        } else {
          Logger.log("محاولة " + (a + 1) + " فشلت للسؤال [" + ((q.title || "").trim() || ("سؤال " + (n + 1))) + "] (" + rr.code + "): " + String(rr.text).slice(0, 200));
        }
      } catch (ee) {
        Logger.log("استثناء أثناء إنشاء سؤال: " + ee);
      }
    }
    if (!done) {
      skipped++;
      Logger.log("تُخطّي سؤال بعد 3 محاولات: " + ((q.title || "").trim() || ("سؤال " + (n + 1))));
    }
    if ((n + 1) % 10 === 0) Logger.log("تقدم: " + (n + 1) + "/" + data.questions.length);
  }

  Logger.log("تم إنشاء " + created + " عنصراً" + (skipped ? " (تُخطّي " + skipped + ")" : "") + (noKey ? " — تنبيه: " + noKey + " سؤال بلا مفتاح إجابة" : ""));
  Logger.log("الصور داخل الأسئلة: " + imgOk + (imgFail ? " (تعذر " + imgFail + ")" : ""));
  Logger.log("رابط التحرير: https://docs.google.com/forms/d/" + formId + "/edit");
}
`;
  download(`${safeName(form.title)}-rest.gs`, script, "text/plain;charset=utf-8");
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
