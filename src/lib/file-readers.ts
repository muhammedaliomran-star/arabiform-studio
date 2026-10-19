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

/** ========================================================================
   مستعرض PDF خالص داخل المتصفح (بلا أي مكتبة خارجية أو CDN).
   يقرأバイات PDF مباشرة، يستخرج التدفقات (streams)، يفك ضغط FlateDecode
   عبر DecompressionStream المدمج في المتصفح، ويستخرج أوامر النص (Tj/TJ).
   ======================================================================== */

/** قراءة عدد صحيح 32 بت Little-Endian. */
const readU32 = (data: Uint8Array, off: number): number =>
  data[off] | (data[off + 1] << 8) | (data[off + 2] << 16) | (data[off + 3] << 24);

/** قراءة عدد صحيح 16 بت Little-Endian. */
const readU16 = (data: Uint8Array, off: number): number =>
  data[off] | (data[off + 1] << 8);

/** البحث عن تسلسل بايتات داخل بيانات PDF. */
const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array, from = 0): number => {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
};

/**فك ضغط تدفق مضغوط بـ FlateDecode باستخدام DecompressionStream المدمج. */
async function inflateFlate(data: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([data]);
  const stream = blob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** تحليل رأس عضو ZIP محلي (مستخدم في docx فقط؛ PDF لا يستخدم ZIP). */
const parseLocalHeader = (off: number, data: Uint8Array) => {
  if (readU32(data, off) !== 0x04034b50) return null;
  const compression = readU16(data, off + 8);
  const compSize = readU32(data, off + 18);
  const nameLen = readU16(data, off + 26);
  const extraLen = readU16(data, off + 28);
  const name = new TextDecoder().decode(data.slice(off + 30, off + 30 + nameLen));
  const dataStart = off + 30 + nameLen + extraLen;
  return { name, compression, compSize, dataStart };
};

/** استخراج نص من ملف Word .docx عبر API المتصفح المدمج. */
async function readDocxFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  let docXmlBytes: Uint8Array | null = null;
  let offset = 0;
  const maxOffset = data.length - 4;
  while (offset < maxOffset) {
    const header = parseLocalHeader(offset, data);
    if (!header) break;
    if (
      header.name === "word/document.xml" ||
      header.name === "word/document.xml".toUpperCase()
    ) {
      if (header.compression === 0) {
        docXmlBytes = data.slice(header.dataStart, header.dataStart + header.compSize);
      } else if (header.compression === 8) {
        docXmlBytes = await inflateFlate(
          data.slice(header.dataStart, header.dataStart + header.compSize)
        );
      }
      break;
    }
    offset = header.dataStart + header.compSize;
    if (offset <= 0 || offset > data.length) break;
  }

  if (!docXmlBytes) {
    return new TextDecoder("utf-8")
      .decode(data)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const xml = new TextDecoder("utf-8").decode(docXmlBytes);
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

/** ========================================================================
   تحليل PDF
   ======================================================================== */

/** تقسيم محتوى PDF إلى كائنات (objects) بناءً على نمط "numero generazione obj ... endobj". */
const findObjects = (data: Uint8Array): Array<{ number: number; gen: number; start: number; end: number }> => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  const objects: Array<{ number: number; gen: number; start: number; end: number }> = [];
  const objRe = /(\d+)\s+(\d+)\s+obj/g;
  let match: RegExpExecArray | null;
  while ((match = objRe.exec(text)) !== null) {
    const start = match.index;
    const endText = text.indexOf("endobj", start);
    if (endText < 0) break;
    const end = endText + "endobj".length;
    objects.push({
      number: parseInt(match[1], 10),
      gen: parseInt(match[2], 10),
      start,
      end,
    });
  }
  return objects;
};

/** استخراج نص سلسلة PDF من مشغل (Tj) أو مصفوفة (TJ). */
const extractStringFromPdf = (raw: string): string => {
  // سلسلة بين قوسين: (نص)
  if (raw.startsWith("(") && raw.endsWith(")")) {
    let s = raw.slice(1, -1);
    // فك الهروب: \n \r \t \b \f \\ \( \)
    s = s
      .replace(/\\([nrtbf\\()])/g, (_m, c) => {
        const map: Record<string, string> = {
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
          "\\": "\\",
          "(": "(",
          ")": ")",
        };
        return map[c] ?? c;
      })
      .replace(/\\([0-7]{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
    return s;
  }
  // سلسلة هكس: <hex>
  if (raw.startsWith("<") && raw.endsWith(">")) {
    const hex = raw.slice(1, -1).replace(/\s/g, "");
    if (!hex) return "";
    // PDF hex strings आमतौरاً UTF-16BE للنص العربي
    const bytes = [];
    for (let i = 0; i + 1 < hex.length; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return new TextDecoder("utf-16be", { fatal: false }).decode(new Uint8Array(bytes));
  }
  return raw;
};

/** استخراج نصوص من محتوى تدفق صفحة PDF واحد. */
const extractPageText = (streamBytes: Uint8Array): string => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(streamBytes);
  const parts: string[] = [];

  // العثور على مشغلي النص: Tj و TJ
  const tjRe = /\(([^)]*(?:\\.[^)]*)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRe.exec(text)) !== null) {
    parts.push(extractStringFromPdf(`(${m[1]})`));
  }

  const tjArrayRe = /\[([^\]]*)\]\s*TJ/g;
  while ((m = tjArrayRe.exec(text)) !== null) {
    const inner = m[1];
    const strRe = /\(([^)]*(?:\\.[^)]*)*)\)/g;
    let sm: RegExpExecArray | null;
    while ((sm = strRe.exec(inner)) !== null) {
      parts.push(extractStringFromPdf(`(${sm[1]})`));
    }
    // سلاسل هكس داخل المصفوفة
    const hexRe = /<([0-9a-fA-F\s]*)>/g;
    let hm: RegExpExecArray | null;
    while ((hm = hexRe.exec(inner)) !== null) {
      parts.push(extractStringFromPdf(`<${hm[1]}>`));
    }
  }

  return parts.join(" ");
};

/** العثور على كائن الترويسة (trailer) وتحديد جدول المراجع (xref). */
const findTrailer = (text: string): { startxref: number; size?: number; root?: number } => {
  const startxrefMatch = text.match(/startxref\s*\n?(\d+)/);
  const startxref = startxrefMatch ? parseInt(startxrefMatch[1], 10) : -1;
  const sizeMatch = text.match(/\/\s*Size\s+(\d+)/);
  const rootMatch = text.match(/\/\s*Root\s+(\d+)\s+\d+\s+R/);
  return {
    startxref,
    size: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
    root: rootMatch ? parseInt(rootMatch[1], 10) : undefined,
  };
};

/** تحليل جدول المراجع (xref) مباشرة إذا كان موجوداً كنص. */
const parseXrefTable = (text: string): Map<number, number> => {
  const map = new Map<number, number>();
  const xrefStart = text.indexOf("xref");
  if (xrefStart < 0) return map;
  const section = text.slice(xrefStart);
  const lines = section.split("\n");
  let currentObj = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line === "trailer" || line === "startxref") break;
    // سطرين: "0 5" ثم "0000000000 00000 n "
    const objMatch = line.match(/^(\d+)\s+(\d+)$/);
    if (objMatch) {
      currentObj = parseInt(objMatch[1], 10);
      continue;
    }
    const entryMatch = line.match(/^(\d{10})\s+\d{5}\s+[nf]/);
    if (entryMatch && currentObj >= 0) {
      map.set(currentObj, parseInt(entryMatch[1], 10));
      currentObj++;
    }
  }
  return map;
};

/** استخراج كائن 숫ي من النص الخام باستخدام الموضع. */
const getObjectBytes = (data: Uint8Array, objNum: number): Uint8Array | null => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  const pattern = new RegExp(`${objNum}\\s+0\\s+obj`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const endText = text.indexOf("endobj", start);
    if (endText < 0) break;
    return data.slice(start, endText + "endobj".length);
  }
  return null;
};

/** استخراج رقم الكائن المستهدف من إدخال من نوع R (Reference). */
const resolveRef = (raw: string): number | null => {
  const m = raw.match(/(\d+)\s+\d+\s+R/);
  return m ? parseInt(m[1], 10) : null;
};

/** استخراج قيمة مفتاح من قاموس PDF (مثل /Contents 5 0 R). */
const dictGet = (dict: string, key: string): string | null => {
  const m = dict.match(new RegExp(`/${key}\\s+([^\\s\\n/]+)`));
  return m ? m[1] : null;
};

const dictGetRef = (dict: string, key: string): number | null => {
  const raw = dictGet(dict, key);
  return raw ? resolveRef(raw) : null;
};

/** قراءة ملف PDF واستخراج نصه بالكامل (بلا أي مكتبة خارجية). */
async function readPdfFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // التحقق من رأس PDF
  const header = new TextDecoder("ascii").decode(data.slice(0, 5));
  if (!header.startsWith("%PDF-")) {
    throw new Error("الملف ليس صيغة PDF صالحة.");
  }

  const fullText = new TextDecoder("utf-8", { fatal: false }).decode(data);
  const trailer = findTrailer(fullText);
  const xrefMap = parseXrefTable(fullText);

  // إيجاد كائنات الصفحات
  const objects = findObjects(data);
  const pages: number[] = [];
  const pageRefs: number[] = [];

  // إذا وجدنا جدول مراجع، نستخدمه لتحديد مواقع الكائنات
  //反之، نعتمد على findObjects الذي搜索 عن أنماط obj

  // العثور على كتالوج الجذر وصفحاته
  let rootObjNum = trailer.root;
  if (!rootObjNum && objects.length > 0) {
    rootObjNum = objects[0].number;
  }

  // البحث عن كائن Pages من خلال遍历 الكائنات
  let pagesObjNum: number | null = null;
  for (const obj of objects) {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(
      data.slice(obj.start, obj.end)
    );
    if (raw.includes("/Type") && raw.includes("/Pages")) {
      pagesObjNum = obj.number;
      break;
    }
  }

  // استخراج أعداد الصفحات من كائن Pages
  let kids: number[] = [];
  if (pagesObjNum) {
    const pagesRaw = getObjectBytes(data, pagesObjNum);
    if (pagesRaw) {
      const pagesText = new TextDecoder("utf-8", { fatal: false }).decode(pagesRaw);
      const kidsMatch = pagesText.match(/\/Kids\s*\[([^\]]+)\]/);
      if (kidsMatch) {
        kids = kidsMatch[1]
          .split(/\s+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => resolveRef(t))
          .filter((n): n is number => n !== null);
      }
    }
  }

  // إذا لم نجد Kids عبر القاموس، نبحث عن جميع الكائنات من نوع /Page
  if (kids.length === 0) {
    for (const obj of objects) {
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(
        data.slice(obj.start, obj.end)
      );
      if (raw.includes("/Type") && raw.includes("/Page")) {
        kids.push(obj.number);
      }
    }
  }

  // استخراج نص كل صفحة
  const pageTexts: string[] = [];
  for (const pageNum of kids) {
    const pageRaw = getObjectBytes(data, pageNum);
    if (!pageRaw) continue;
    const pageText = new TextDecoder("utf-8", { fatal: false }).decode(pageRaw);

    const contentsRef = dictGetRef(pageText, "Contents");
    if (!contentsRef) continue;

    const contentRaw = getObjectBytes(data, contentsRef);
    if (!contentRaw) continue;

    // استخراج بايتات التدفق بين stream و endstream
    const contentText = new TextDecoder("utf-8", { fatal: false }).decode(contentRaw);
    const streamStart = contentText.indexOf("stream");
    const streamEnd = contentText.indexOf("endstream");
    if (streamStart < 0 || streamEnd < 0) continue;

    let streamBytes = data.slice(
      contentRaw.byteOffset + contentText.indexOf("\n", streamStart) + 1,
      contentRaw.byteOffset + streamEnd
    );

    // التحقق من فلتر الضغط
    const isFlate = /\/Filter\s*\/FlateDecode/.test(contentText) ||
      /\/Filter\s*\[\s*\/FlateDecode/.test(contentText);

    if (isFlate) {
      try {
        streamBytes = await inflateFlate(streamBytes);
      } catch {
        // لو فشل فك الضغط، نحاول استخدام البايتات الخام
      }
    }

    const pageTextExtracted = extractPageText(streamBytes);
    if (pageTextExtracted.trim()) {
      pageTexts.push(pageTextExtracted);
    }
  }

  const joined = pageTexts.join("\n").trim();
  if (joined.length === 0) {
    throw new Error(
      "لم يتم العثور على نص في ملف الـ PDF. قد يكون الملف ممسوحاً ضوئياً (صور فقط) — يرجى نسخ النص ولصقه مباشرة بدلاً من رفع الملف."
    );
  }
  return joined;
}

/** ========================================================================
   واجهة reading الموحدة
   ======================================================================== */

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
