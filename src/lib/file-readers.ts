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

/*==============================================================================
  قراءة ملف Word .docx عبر API المتصفح المدمج.
  ملف docx هو ZIP يحوي word/document.xml. نحلل رؤوس ZIP المحلية يدوياً
  ونفك ضغط العضو المستهدف باستخدام DecompressionStream المتوافر في المتصفح.
==============================================================================*/

/** قراءة عدد صحيح 32 بت Little-Endian. */
const readU32 = (data: Uint8Array, off: number): number =>
  data[off] | (data[off + 1] << 8) | (data[off + 2] << 16) | (data[off + 3] << 24);

/** قراءة عدد صحيح 16 بت Little-Endian. */
const readU16 = (data: Uint8Array, off: number): number =>
  data[off] | (data[off + 1] << 8);

/** التحليل اليدوي لرأس عضو ZIP محلي وإرجاع موقع البيانات وطولها واسمها. */
const parseZipLocalHeader = (
  data: Uint8Array,
  off: number,
): { name: string; compression: number; compSize: number; dataStart: number } | null => {
  if (readU32(data, off) !== 0x04034b50) return null;
  const compression = readU16(data, off + 8); // 0=substored, 8=deflate
  const compSize = readU32(data, off + 18);
  const nameLen = readU16(data, off + 26);
  const extraLen = readU16(data, off + 28);
  const name = new TextDecoder().decode(data.slice(off + 30, off + 30 + nameLen));
  const dataStart = off + 30 + nameLen + extraLen;
  return { name, compression, compSize, dataStart };
};

/** فك ضغط تدفق مضغوط بـ Flate/deflate باستخدام DecompressionStream المدمج في المتصفح. */
async function inflateFlate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const blob = new Blob([data]);
  const stream = blob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function readDocxFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  let docXmlBytes: Uint8Array | null = null;
  let offset = 0;
  const maxOffset = data.length - 4;
  while (offset < maxOffset) {
    const header = parseZipLocalHeader(data, offset);
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
    // fallback: لو لم نجد العضو، نعيد النص الخام كمحاولة أخيرة
    return new TextDecoder("utf-8")
      .decode(data)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const xml = new TextDecoder("utf-8").decode(docXmlBytes);
  // فك ترميز الكيانات الأساسية في XML
  const decodeXml = (s: string): string =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&amp;/g, "&"); // آخرًا لتفادي "&amp;amp;"

  // تقسيم حسب الفقرات <w:p ...> أو <w:p> أولاً، ثم استخراج النصوص داخل كل فقرة.
  // هذا يحافظ على حدود الأسطر/الفقرات بدل دمج كل شيء في سطر واحد.
    const paragraphs = xml.split(/<w:p[\s>]/);
  const lines: string[] = [];
  for (let i = 1; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const paraEnd = para.indexOf("</w:p>");
    const paraContent = paraEnd >= 0 ? para.slice(0, paraEnd) : para;

    const parts: string[] = [];
    const runRe = /<w:r>([\s\S]*?)<\/w:r>/g;
    let rm: RegExpExecArray | null;
    while ((rm = runRe.exec(paraContent)) !== null) {
      const runContent = rm[1];
      const isHighlighted = /<w:highlight[^>]*w:val="yellow"/i.test(runContent);
      const tMatch = runContent.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
      const text = tMatch ? decodeXml(tMatch[1]) : "";
      if (text.length === 0) continue;
      if (isHighlighted) {
        parts.push("[[HL]]" + text + "[[/HL]]");
      } else {
        parts.push(text);
      }
    }

    const line = parts.join("").trim();
    lines.push(line);
  }  const joined = lines.join("\n");
  return joined.trim().length > 0 ? joined : xml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/*==============================================================================
  مستعرض PDF خالص داخل المتصفح (بلا أي مكتبة خارجية أو CDN).
  يقرأバイات PDF مباشرة، يستخرج التدفقات (streams)، يفك ضغط FlateDecode
  عبر DecompressionStream المدمج في المتصفح، ويستخرج أوامر النص (Tj/TJ).
  يدعم جدول ToUnicode لتحويل أكواد الحروف إلى يونيكود (نص عربي صحيح).
==============================================================================*/

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

const STREAM_MARKER = new TextEncoder().encode("stream");
const ENDSTREAM_MARKER = new TextEncoder().encode("endstream");

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
  // سلسلة هكس: <hex> — تُفك غالباً كـ UTF-16BE (الشائعة في PDF العربي)
  if (raw.startsWith("<") && raw.endsWith(">")) {
    const hex = raw.slice(1, -1).replace(/\s/g, "");
    if (!hex) return "";
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

  // مشغل Tj: (نص) Tj
  const tjRe = /\(([^)]*(?:\\.[^)]*)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRe.exec(text)) !== null) {
    parts.push(extractStringFromPdf(`(${m[1]})`));
  }

  // مشغل TJ: [(نص1) (نص2) <hex>] TJ
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

/*------------------------------------------------------------------------------
  تحليل كائنات PDF وجدول المراجع (xref)
------------------------------------------------------------------------------*/

/** تقسيم محتوى PDF إلى كائنات بناءً على نمط "numero generazione obj ... endobj". */
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

/** العثور على كائن الترويسة (trailer) وتحديد موقع startxref. */
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
    // سطر الأول: "0 5" ثم entrées: "0000000000 00000 n "
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

/** استخراج بايتات كائن PDF رقمي باستخدام رقمه، مع إرجاع موقع البداية في البيانات الأصلية. */
const getObjectBytes = (
  data: Uint8Array,
  objNum: number,
): { bytes: Uint8Array; start: number } | null => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  // يطابق رقم الكائن مع أي رقم جيل (gen)، وليس فقط الصفر
  const pattern = new RegExp(`${objNum}\\s+\\d+\\s+obj`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const endText = text.indexOf("endobj", start);
    if (endText < 0) break;
    return { bytes: data.slice(start, endText + "endobj".length), start };
  }
  return null;
};

/** استخراج رقم الكائن من إدخال مرجع من نوع R (مثل 5 0 R). */
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

/*------------------------------------------------------------------------------
  جدول ToUnicode CMap — يرمز أكواد الحروف (CIDs) إلى يونيكود.
------------------------------------------------------------------------------*/

type ToUnicodeEntry = { code: number; unicode: number };

/** تحليل جدول ToUnicode من تيار PDF مضغوط أو غير مضغوط. */
async function parseToUnicodeCMap(
  data: Uint8Array,
  objNum: number,
): Promise<Map<number, number> | null> {
  const found = getObjectBytes(data, objNum);
  if (!found) return null;

  const dictText = new TextDecoder("utf-8", { fatal: false }).decode(found.bytes);
  // التحقق من وجود مفتاح /ToUnicode في القاموس
  const toUnicodeRef = dictGetRef(dictText, "ToUnicode");
  if (!toUnicodeRef) return null;

  const toUnicodeObj = getObjectBytes(data, toUnicodeRef);
  if (!toUnicodeObj) return null;

  // فك ضغط التيار إذا كان مضغوطاً
  const dictLower = dictText.toLowerCase();
  const isFlate = /\/filter\s*\/flatdecode/.test(dictLower) || /\/filter\s*\[\s*\/flatdecode/.test(dictLower);
  let streamBytes: Uint8Array;

  const dictContent = new TextDecoder("utf-8", { fatal: false }).decode(toUnicodeObj.bytes);
  const streamStart = indexOfBytes(toUnicodeObj.bytes, STREAM_MARKER);
  const streamEnd = indexOfBytes(toUnicodeObj.bytes, ENDSTREAM_MARKER);
  if (streamStart < 0 || streamEnd < 0) return null;

  let offset = streamStart + STREAM_MARKER.length;
  if (offset < toUnicodeObj.bytes.length && toUnicodeObj.bytes[offset] === 0x0d) offset++;
  if (offset < toUnicodeObj.bytes.length && toUnicodeObj.bytes[offset] === 0x0a) offset++;

  streamBytes = toUnicodeObj.bytes.slice(offset, streamEnd);

  if (isFlate) {
    try {
      streamBytes = await inflateFlate(streamBytes);
    } catch {
      return null;
    }
  }

  const cmapText = new TextDecoder("utf-8", { fatal: false }).decode(streamBytes);
  const map = new Map<number, number>();

  // beginbfchar ... endbfchar
  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let cm: RegExpExecArray | null;
  while ((cm = bfcharRe.exec(cmapText)) !== null) {
    const inner = cm[1];
    const pairRe = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pairRe.exec(inner)) !== null) {
      const code = parseInt(pm[1], 16);
      const unicode = parseInt(pm[2], 16);
      if (!isNaN(code) && !isNaN(unicode)) map.set(code, unicode);
    }
  }

  // beginbfrange ... endbfrange
  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((cm = bfrangeRe.exec(cmapText)) !== null) {
    const inner = cm[1];
    // شكل 1: <start> <end> <unicode_start>  (نطاق مع بداية يونيكود)
    const rangeRe1 = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
    let rm: RegExpExecArray | null;
    while ((rm = rangeRe1.exec(inner)) !== null) {
      const start = parseInt(rm[1], 16);
      const end = parseInt(rm[2], 16);
      const base = parseInt(rm[3], 16);
      if (!isNaN(start) && !isNaN(end) && !isNaN(base)) {
        for (let c = start; c <= end; c++) map.set(c, base + (c - start));
      }
    }
    // شكل 2: <start> <end> [ <unicode1> <unicode2> ... ]  (قائمة صريحة)
    const rangeRe2 = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+\[([^\]]*)\]/g;
    while ((rm = rangeRe2.exec(inner)) !== null) {
      const start = parseInt(rm[1], 16);
      const end = parseInt(rm[2], 16);
      const codes = rm[3]
        .match(/<([0-9a-fA-F]+)>/g)
        ?.map((h) => parseInt(h.slice(1, -1), 16))
        .filter((c) => !isNaN(c));
      if (codes && !isNaN(start) && !isNaN(end)) {
        for (let i = 0; i < codes.length && start + i <= end; i++) {
          map.set(start + i, codes[i]);
        }
      }
    }
  }

  return map.size > 0 ? map : null;
}

/** استخراج أرقام كائنات ToUnicode من الخطوط المستخدمة في صفحة PDF.
    نبحث عن جميع إحالات الكائنات في نص الصفحة ونتحقق مما إذا كانت كائنات خط تحتوي على /ToUnicode. */
const findFontToUnicodeRefs = (
  pageDictText: string,
  data: Uint8Array,
): number[] => {
  const refs: number[] = [];
  const checked = new Set<number>();

  // العثور على جميع الإحالات من نوع "الاسم 5 0 R" في نص الصفحة
  const refRe = /\/\w+\s+(\d+)\s+\d+\s+R/g;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(pageDictText)) !== null) {
    const objNum = parseInt(m[1], 10);
    if (checked.has(objNum)) continue;
    checked.add(objNum);

    const fontObj = getObjectBytes(data, objNum);
    if (!fontObj) continue;
    const fontText = new TextDecoder("utf-8", { fatal: false }).decode(fontObj.bytes);
    if (!fontText.includes("/ToUnicode")) continue;

    const tuRef = dictGetRef(fontText, "ToUnicode");
    if (tuRef) refs.push(tuRef);
  }
  return refs;
};

/*------------------------------------------------------------------------------
  قراءة ملف PDF واستخراج نصه بالكامل (بلا أي مكتبة خارجية).
------------------------------------------------------------------------------*/

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
  const objects = findObjects(data);

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
      const pagesText = new TextDecoder("utf-8", { fatal: false }).decode(pagesRaw.bytes);
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
    const pageText = new TextDecoder("utf-8", { fatal: false }).decode(pageRaw.bytes);

    const contentsRef = dictGetRef(pageText, "Contents");
    if (!contentsRef) continue;

    const contentRaw = getObjectBytes(data, contentsRef);
    if (!contentRaw) continue;

    // استخراج بايتات التدفق بين stream و endstream (في بايتات المحتوى نفسها، وليس البيانات الأصلية)
    const streamStart = indexOfBytes(contentRaw.bytes, STREAM_MARKER);
    const streamEnd = indexOfBytes(contentRaw.bytes, ENDSTREAM_MARKER);
    if (streamStart < 0 || streamEnd < 0) continue;

    let offset = streamStart + STREAM_MARKER.length;
    if (offset < contentRaw.bytes.length && contentRaw.bytes[offset] === 0x0d) offset++;
    if (offset < contentRaw.bytes.length && contentRaw.bytes[offset] === 0x0a) offset++;

    let streamBytes = contentRaw.bytes.slice(offset, streamEnd);

    // التحقق من فلتر الضغط
    const contentDict = new TextDecoder("utf-8", { fatal: false }).decode(contentRaw.bytes);
    const isFlate =
      /\/Filter\s*\/FlateDecode/.test(contentDict) ||
      /\/Filter\s*\[\s*\/FlateDecode/.test(contentDict);

    if (isFlate) {
      try {
        streamBytes = await inflateFlate(streamBytes);
      } catch {
        // لو فشل فك الضغط، نحاول استخدام البايتات الخام
      }
    }

    // بناء خريطة ToUnicode للصفحة إذا وجدنا خطوطاً بها
    const toUnicodeRefs = findFontToUnicodeRefs(pageText, data);
    let toUnicodeMap: Map<number, number> | null = null;
    if (toUnicodeRefs.length > 0) {
      // نستخدم أول خريطة وُجدت (غالباً خط واحد في الصفحة)
      toUnicodeMap = await parseToUnicodeCMap(data, toUnicodeRefs[0]);
    }

    let pageTextExtracted = extractPageText(streamBytes);

    // تطبيق خريطة ToUnicode إذا كانت متاحة
    if (toUnicodeMap && toUnicodeMap.size > 0) {
      pageTextExtracted = applyToUnicodeMap(pageTextExtracted, toUnicodeMap);
    }

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

/** تطبيق خريطة ToUnicode على نص مستخرج: استبدال كل رمز برقم يونيكود مطابق. */
function applyToUnicodeMap(text: string, map: Map<number, number>): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const mapped = map.get(code);
    result += mapped !== undefined ? String.fromCharCode(mapped) : text[i];
  }
  return result;
}

/*==============================================================================
  واجهة reading الموحدة
==============================================================================*/

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


