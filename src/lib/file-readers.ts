/** قراءة ملف نصي (txt) من المتصفح دون رفعه لأي جهة. */
export async function readTextFile(file: File): Promise<string> {
  const text = await file.text();
  return text;
}

/** ملحقات تُقرأ مباشرة في المتصفح (نص + PDF + Word .docx). */
const DIRECT_EXTENSIONS = [".txt", ".md", ".pdf", ".docx"];

/** ملحقات لا تزال تحتاج تحويلاً خارجياً (.doc القديم، RTF). */
export const REQUIRES_CONVERSION = [".doc", ".rtf"];

export function isSupportedTextFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return DIRECT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** استخراج نص من ملف Word .docx عبر API المتصفح المدمج.
   ملف docx هو ZIP يحوي word/document.xml. نحلل رؤوس ZIP المحلية يدوياً
   ونفك ضغط العضو المستهدف باستخدام DecompressionStream المتوافر في المتصفح. */
async function readDocxFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  /** قراءة عدد صحيح 32 بت Little-Endian من offset معين. */
  const readU32 = (off: number): number =>
    data[off] | (data[off + 1] << 8) | (data[off + 2] << 16) | (data[off + 3] << 24);

  /** قراءة عدد صحيح 16 بت Little-Endian. */
  const readU16 = (off: number): number => data[off] | (data[off + 1] << 8);

  /** تحليل رأس عضو ZIP محلي وإرجاع موقع البيانات المضغوطة وطولها واسم الملف. */
  const parseLocalHeader = (off: number) => {
    const signature = readU32(off);
    if (signature !== 0x04034b50) return null;
    const compression = readU16(off + 8); // 0=substored, 8=deflate
    const compSize = readU32(off + 18);
    const nameLen = readU16(off + 26);
    const extraLen = readU16(off + 28);
    const name = new TextDecoder().decode(
      data.slice(off + 30, off + 30 + nameLen)
    );
    const dataStart = off + 30 + nameLen + extraLen;
    return { name, compression, compSize, dataStart };
  };

  /**走遍 كل أعضاء ZIP المحلي بحثاً عن word/document.xml. */
  let docXmlBytes: Uint8Array | null = null;
  let offset = 0;
  const maxOffset = data.length - 4;
  while (offset < maxOffset) {
    const header = parseLocalHeader(offset);
    if (!header) break;
    if (
      header.name === "word/document.xml" ||
      header.name === "word/document.xml".toUpperCase()
    ) {
      if (header.compression === 0) {
        // غير مضغوط
        docXmlBytes = data.slice(header.dataStart, header.dataStart + header.compSize);
      } else if (header.compression === 8) {
        // مضغوط deflate → نفك الضغط عبر DecompressionStream
        const blob = new Blob([data.slice(header.dataStart, header.dataStart + header.compSize)]);
        const stream = blob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
        const buf = await new Response(stream).arrayBuffer();
        docXmlBytes = new Uint8Array(buf);
      }
      break;
    }
    offset = header.dataStart + header.compSize;
    // الوقاية من اللولب اللانهائي
    if (offset <= 0 || offset > data.length) break;
  }

  if (!docXmlBytes) {
    // fallback: لو لم نجد العضو، نعيد النص الخام كمحاولة أخيرة
    return new TextDecoder("utf-8").decode(data).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  const xml = new TextDecoder("utf-8").decode(docXmlBytes);
  // استخراج محتوى وسوم <w:t>...</w:t>
  const parts = xml.split("<w:t");
  const words: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const close = parts[i].indexOf(">");
    if (close < 0) continue;
    const after = parts[i].slice(close + 1);
    const end = after.indexOf("<");
    const word = end < 0 ? after : after.slice(0, end);
    if (word) words.push(word);
  }

  const joined = words.join(" ");
  return joined.trim().length > 0 ? joined : xml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** قراءة ملف PDF عبر تحميل ديناميكي لـ pdf.js من CDN (مرة واحدة لكل جلسة). */
let pdfjsLib: any | null = null;
let pdfjsLoading: Promise<any> | null = null;

function loadPdfJs(): Promise<any> {
  if (pdfjsLib) return Promise.resolve(pdfjsLib);
  if (pdfjsLoading) return pdfjsLoading;

  // قائمة روابط CDN للمكتبة (يُجرب الأولى ثم الاحتياطية تلقائياً).
  const cdnSources: Array<{ lib: string; worker: string }> = [
    {
      lib: "https://cdn.jsdelivr.net/npm/pdfjs-dist@legacy/build/pdf.min.js",
      worker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@legacy/build/pdf.worker.min.js",
    },
    {
      lib: "https://unpkg.com/pdfjs-dist@legacy/build/pdf.min.js",
      worker: "https://unpkg.com/pdfjs-dist@legacy/build/pdf.worker.min.js",
    },
  ];

  let lastError: string | null = null;

  const tryNext = (index: number): Promise<any> => {
    if (index >= cdnSources.length) {
      return rejectLast();
    }
    const { lib, worker } = cdnSources[index];
    return new Promise<any>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = lib;
      script.onload = () => {
        const loadedLib = (window as any).pdfjsLib ?? (window as any).pdfjsDist;
        if (loadedLib) {
          loadedLib.GlobalWorkerOptions.workerSrc = worker;
          pdfjsLib = loadedLib;
          resolve(loadedLib);
        } else {
          lastError = "تم تحميل pdf.js لكنه لم يُعرّف بشكل صحيح.";
          rejectLastInternal(index + 1, resolve, reject);
        }
      };
      script.onerror = () => {
        lastError = `تعذّر تحميل المكتبة من ${lib}.`;
        rejectLastInternal(index + 1, resolve, reject);
      };
      document.head.appendChild(script);
    });
  };

  const rejectLastInternal = (
    nextIndex: number,
    resolve: (value: any) => void,
    reject: (reason?: any) => void
  ) => {
    tryNext(nextIndex).then(resolve, (err) => reject(err ?? lastError));
  };

  const rejectLast = (): Promise<any> =>
    Promise.reject(
      new Error(lastError || "تعذّر تحميل مكتبة قراءة ملفات PDF من الإنترنت.")
    );

  return tryNext(0);
}

async function readPdfFile(file: File): Promise<string> {
  const lib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = lib.getDocument({
    data: arrayBuffer,
  });
  const pdf = await loadingTask.promise;

  if (pdf.numPages === 0) {
    throw new Error("الملف PDF فارغ أو لا يحتوي على صفحات.");
  }

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => item.str)
      .join(" ");
    pages.push(text);
  }

  const joined = pages.join("\n").trim();
  if (joined.length === 0) {
    throw new Error(
      "لم يتم العثور على نص في ملف الـ PDF. قد يكون الملف ممسوحاً ضوئياً (صور فقط) — يرجى نسخ النص ولصقه مباشرة بدلاً من رفع الملف."
    );
  }
  return joined;
}

/** قراءة أي ملف مدعوم وتُعيد نصه المستخرج. */
export async function readFileContent(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const ext = name.slice(name.lastIndexOf("."));

  if (ext === ".txt" || ext === ".md") {
    return readTextFile(file);
  }
  if (ext === ".docx") {
    return readDocxFile(file);
  }
  if (ext === ".pdf") {
    return readPdfFile(file);
  }
  throw new Error(`نوع الملف "${ext}" غير مدعوم للاستيراد النصي.`);
}

/** رسالة توجيه للمستخدم عند اختيار ملف يحتاج تحويلاً خارجياً. */
export function conversionHint(file: File): string {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (REQUIRES_CONVERSION.includes(ext)) {
    return `الملف "${file.name}" من نوع ${ext.toUpperCase()} يحتاج تحويلاً قبل الاستيراد.
الرجاء أحد الخيارين:
1. افتح الملف في وورد/بي دي إف → احفظه كـ "نص عادي (.txt)" أو ".docx" ثم استيرده من هنا.
2. انسخ محتوى الملف والصقه في مربع النص أدناه واستورد من النص مباشرة.`;
  }
  return `نوع الملف "${ext}" غير مدعوم للاستيراد النصي.`;
}
