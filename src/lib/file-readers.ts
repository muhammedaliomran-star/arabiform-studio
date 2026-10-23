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
    const runRe = /<w:r[\s>]([\s\S]*?)<\/w:r>/g;
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
  يقرأ بايتات الملف مباشرة على مستوى البايت (لا عبر نص مفكوك) لضمان دقة
  الإزاحات في الملفات ثنائية الترميز، ويدعم:
  - كائنات ObjStm (كائنات مضغوطة داخل تدفق واحد).
  - /Contents كإحالة واحدة أو مصفوفة تدفقات.
  - خطوطاً متعددة لكل صفحة عبر /Resources /Font مع جداول ToUnicode.
  - أسطر جديدة حسب موضع النص (Td/TD/Tm/T*) بدل دمج كل شيء في سطر واحد.
  - الخطوط ثنائية البايت (Identity-H) الشائعة في الخطوط العربية.
  - اتجاه النص العربي: عكس الأسطر المخزنة بالترتيب البصري + توحيد الأشكال.
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
const ENDOBJ_MARKER = new TextEncoder().encode("endobj");

/** تدفقات FlateDecode في PDF بصيغة zlib (RFC 1950) — تختلف عن deflate الخام في ZIP/docx. */
async function inflateZlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const blob = new Blob([data]);
  const stream = blob.stream().pipeThrough(new DecompressionStream("deflate"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** فك ترميز بايتس كنص لاتيني خام (بايت = رمز) دون تأثر جدول محارف النظام. */
const decodePdfBytes = (u8: Uint8Array): string => {
  // TextDecoder بترميز "latin1" يحوّل نطاق 0x80-0x9F إلى رموز مختلفة، لذا نفك يدوياً.
  const CHUNK = 8192;
  let out = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    out += String.fromCharCode.apply(
      null,
      Array.from(u8.subarray(i, i + CHUNK)) as unknown as number[]
    );
  }
  return out;
};

type PdfObject = {
  num: number;
  dictText: string;
  streamBytes: Uint8Array<ArrayBuffer> | null;
  flate: boolean;
};

const isPdfWs = (b: number): boolean =>
  b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0c || b === 0x00;
const isPdfDigit = (b: number): boolean => b >= 0x30 && b <= 0x39;

const parsePdfDec = (u8: Uint8Array, s: number, e: number): number => {
  let v = 0;
  for (let i = s; i < e; i++) v = v * 10 + (u8[i] - 48);
  return v;
};

/** مسح الكائنات على مستوى البايتات: الإزاحات دائماً مطابقة للملف الأصلي. */
const scanPdfObjects = (
  data: Uint8Array
): Array<{ num: number; start: number; end: number }> => {
  const objs: Array<{ num: number; start: number; end: number }> = [];
  const n = data.length;
  for (let i = 0; i < n - 3; i++) {
    if (data[i] !== 0x6f || data[i + 1] !== 0x62 || data[i + 2] !== 0x6a) continue; // "obj"
    let p = i - 1;
    while (p >= 0 && isPdfWs(data[p])) p--;
    const genEnd = p + 1;
    while (p >= 0 && isPdfDigit(data[p])) p--;
    const genStart = p + 1;
    if (genStart >= genEnd) continue;
    while (p >= 0 && isPdfWs(data[p])) p--;
    const numEnd = p + 1;
    while (p >= 0 && isPdfDigit(data[p])) p--;
    const numStart = p + 1;
    if (numStart >= numEnd) continue;
    const end = indexOfBytes(data, ENDOBJ_MARKER, i);
    if (end < 0) break;
    objs.push({
      num: parsePdfDec(data, numStart, numEnd),
      start: numStart,
      end: end + ENDOBJ_MARKER.length,
    });
    i = end + ENDOBJ_MARKER.length - 1;
  }
  return objs;
};

/** تجهيز كائن واحد: نص القاموس + بايتس التدفق (إن وجد) بدقة /Length. */
const loadPdfObject = (
  data: Uint8Array,
  o: { num: number; start: number; end: number }
): PdfObject => {
  const raw = data.slice(o.start, o.end);
  let streamKw = indexOfBytes(raw, STREAM_MARKER, 0);
  let dictText: string;
  let streamBytes: Uint8Array<ArrayBuffer> | null = null;
  let flate = false;

  // علامة stream الحقيقية تسبقها مسافة/سطر؛ أي تطابق سابق (داخل اسم مثل
  // /LastModified أو /PageLayout) يُتجاهل ويُبحث عن الموضع الصحيح.
  if (streamKw > 0 && !isPdfWs(raw[streamKw - 1])) {
    const retry = indexOfBytes(raw, STREAM_MARKER, streamKw + STREAM_MARKER.length);
    if (retry >= 0) streamKw = retry;
  }

  if (streamKw >= 0) {
    dictText = decodePdfBytes(raw.slice(0, streamKw));
    let off = streamKw + STREAM_MARKER.length;
    if (raw[off] === 0x0d) off++;
    if (raw[off] === 0x0a) off++;
    let end = indexOfBytes(raw, ENDSTREAM_MARKER, off);
    if (end < 0) end = raw.length;
    // سطر الفصل قبل endstream ليس جزءاً من بيانات التدفق
    while (end > off && (raw[end - 1] === 0x0d || raw[end - 1] === 0x0a || raw[end - 1] === 0x20))
      end--;
    streamBytes = raw.slice(off, end);
    // /Length كرقم مباشر فقط (وليس إحالة) — الدقة المطلقة لبايات zlib
    const lm = dictText.match(/\/Length\s+(\d+)(?!\d)(?!\s+\d+\s+R)/);
    if (lm) {
      const len = +lm[1];
      if (len > 0 && off + len <= raw.length) {
        const tail = decodePdfBytes(raw.slice(off + len, off + len + 11));
        if (/^(\r\n|\r|\n)?endstream/.test(tail)) streamBytes = raw.slice(off, off + len);
      }
    }
    flate = /\/FlateDecode/.test(dictText);
  } else {
    dictText = decodePdfBytes(raw);
  }

  return { num: o.num, dictText, streamBytes, flate };
};

/** استخراج كائنات ObjStm (كائنات مضغوطة داخل تدفق واحد — شائعة في PDF 1.5+). */
const expandObjStreams = async (objs: PdfObject[]): Promise<PdfObject[]> => {
  const extra: PdfObject[] = [];
  for (const o of objs) {
    if (!o.streamBytes || !/\/Type\s*\/ObjStm/.test(o.dictText)) continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = o.flate ? await inflateZlib(o.streamBytes) : o.streamBytes;
    } catch {
      continue;
    }
    const nM = o.dictText.match(/\/N\s+(\d+)/);
    const fM = o.dictText.match(/\/First\s+(\d+)/);
    if (!nM || !fM) continue;
    const N = +nM[1];
    const First = +fM[1];
    const nums = (decodePdfBytes(bytes.slice(0, First)).match(/\d+/g) || []).map(Number);
    for (let k = 0; k + 1 < nums.length && k / 2 < N; k += 2) {
      const s = First + nums[k + 1];
      const e = k + 3 < nums.length ? First + nums[k + 3] : bytes.length;
      if (s < 0 || e > bytes.length || s >= e) continue;
      extra.push({
        num: nums[k],
        dictText: decodePdfBytes(bytes.slice(s, e)),
        streamBytes: null,
        flate: false,
      });
    }
  }
  return extra;
};

/** تحليل جدول ToUnicode CMap: beginbfchar / beginbfrange (كلا الشكلين). */
const parsePdfCMap = (text: string): Map<number, number> => {
  const map = new Map<number, number>();
  let cm: RegExpExecArray | null;

  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((cm = bfcharRe.exec(text)) !== null) {
    const pairRe = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pairRe.exec(cm[1])) !== null) {
      const code = parseInt(pm[1], 16);
      const uni = parseInt(pm[2], 16);
      if (!isNaN(code) && !isNaN(uni)) map.set(code, uni);
    }
  }

  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((cm = bfrangeRe.exec(text)) !== null) {
    const inner = cm[1];
    const r1 = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
    let r: RegExpExecArray | null;
    while ((r = r1.exec(inner)) !== null) {
      const s = parseInt(r[1], 16);
      const e = parseInt(r[2], 16);
      const base = parseInt(r[3], 16);
      if (isNaN(s) || isNaN(e) || isNaN(base)) continue;
      for (let c = s; c <= e && c - s < 65536; c++) map.set(c, base + (c - s));
    }
    const r2 = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+\[([^\]]*)\]/g;
    while ((r = r2.exec(inner)) !== null) {
      const s = parseInt(r[1], 16);
      const e = parseInt(r[2], 16);
      const codes = (r[3].match(/<([0-9a-fA-F]+)>/g) || [])
        .map((h) => parseInt(h.slice(1, -1), 16))
        .filter((c) => !isNaN(c));
      for (let i = 0; i < codes.length && s + i <= e; i++) map.set(s + i, codes[i]);
    }
  }
  return map;
};

type PdfFont = { cmap: Map<number, number> | null; twoByte: boolean };

/** بناء خرائط خطوط الصفحة: /Resources → /Font → /ToUnicode لكل خط. */
const buildPdfFontMaps = async (
  pageDict: string,
  byNum: Map<number, PdfObject>
): Promise<Map<string, PdfFont>> => {
  let resText = pageDict;
  const resRef = pageDict.match(/\/Resources\s+(\d+)\s+\d+\s+R/);
  if (resRef) {
    const ro = byNum.get(+resRef[1]);
    if (ro) resText = ro.dictText;
  }
  const maps = new Map<string, PdfFont>();
  const fontSec = resText.match(/\/Font\s*<<([\s\S]*?)>>/);
  if (!fontSec) return maps;
  const entries = fontSec[1].match(/\/[\w+#-]+\s+\d+\s+\d+\s+R/g) || [];
  for (const ent of entries) {
    const rm = ent.match(/(\d+)\s+\d+\s+R/);
    const keyMatch = ent.match(/\/[\w+#-]+/);
    if (!rm || !keyMatch) continue;
    const fontObj = byNum.get(+rm[1]);
    if (!fontObj) continue;
    const tuRef = fontObj.dictText.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    const twoByte =
      /\/Subtype\s*\/Type0/.test(fontObj.dictText) ||
      /Identity-H/.test(fontObj.dictText) ||
      /Identity-V/.test(fontObj.dictText);
    let cmap: Map<number, number> | null = null;
    if (tuRef) {
      const tuObj = byNum.get(+tuRef[1]);
      if (tuObj && tuObj.streamBytes) {
        let bytes: Uint8Array<ArrayBuffer> | null = tuObj.streamBytes;
        if (tuObj.flate) {
          try {
            bytes = await inflateZlib(tuObj.streamBytes);
          } catch {
            bytes = null;
          }
        }
        if (bytes) cmap = parsePdfCMap(decodePdfBytes(bytes));
      }
    }
    maps.set(keyMatch[0], { cmap, twoByte });
  }
  return maps;
};

/*--------------------------- محلل محتوى الصفحات ---------------------------*/

type PdfToken =
  | { t: "str"; v: number[] }
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "ao" } // فتح مصفوفة [
  | { t: "ac" } // إغلاق مصفوفة ]
  | { t: "do" } // فتح قاموس <<
  | { t: "dc" }; // إغلاق قاموس >>

/** تقطيع تيار محتوى الصفحة إلى رموز (سلاسل، أسماء، أرقام، أوامر). */
const tokenizePdfContent = (str: string): PdfToken[] => {
  const toks: PdfToken[] = [];
  let i = 0;
  const n = str.length;
  const isWs = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
  const isDelim = (c: string) => "()<>[]{/%".indexOf(c) >= 0;

  while (i < n) {
    const c = str[i];
    if (isWs(c)) {
      i++;
      continue;
    }
    if (c === "%") {
      while (i < n && str[i] !== "\n") i++;
      continue;
    }
    if (c === "(") {
      const bytes: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const ch = str[i];
        if (ch === "\\") {
          const nx = str[i + 1];
          if (nx === "n") { bytes.push(10); i += 2; }
          else if (nx === "r") { bytes.push(13); i += 2; }
          else if (nx === "t") { bytes.push(9); i += 2; }
          else if (nx === "b") { bytes.push(8); i += 2; }
          else if (nx === "f") { bytes.push(12); i += 2; }
          else if (nx === "(") { bytes.push(40); i += 2; }
          else if (nx === ")") { bytes.push(41); i += 2; }
          else if (nx === "\\") { bytes.push(92); i += 2; }
          else if (nx >= "0" && nx <= "7") {
            let oct = "";
            let k = i + 1;
            while (k < n && str[k] >= "0" && str[k] <= "7" && oct.length < 3) {
              oct += str[k];
              k++;
            }
            bytes.push(parseInt(oct, 8) & 0xff);
            i = k;
          } else if (nx === "\n") {
            i += 2;
          } else if (nx !== undefined) {
            bytes.push(nx.charCodeAt(0) & 0xff);
            i += 2;
          } else {
            i++;
          }
        } else if (ch === "(") {
          depth++;
          bytes.push(40);
          i++;
        } else if (ch === ")") {
          depth--;
          if (depth > 0) bytes.push(41);
          i++;
        } else {
          bytes.push(ch.charCodeAt(0) & 0xff);
          i++;
        }
      }
      toks.push({ t: "str", v: bytes });
      continue;
    }
    if (c === "<" && str[i + 1] === "<") { toks.push({ t: "do" }); i += 2; continue; }
    if (c === ">" && str[i + 1] === ">") { toks.push({ t: "dc" }); i += 2; continue; }
    if (c === "<") {
      let hex = "";
      i++;
      while (i < n && str[i] !== ">") {
        const h = str[i];
        if (h !== " " && h !== "\n" && h !== "\r" && h !== "\t") hex += h;
        i++;
      }
      i++;
      if (hex.length % 2) hex += "0";
      const bytes: number[] = [];
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2), 16));
      toks.push({ t: "str", v: bytes });
      continue;
    }
    if (c === "[") { toks.push({ t: "ao" }); i++; continue; }
    if (c === "]") { toks.push({ t: "ac" }); i++; continue; }
    if (c === "/") {
      let name = "/";
      i++;
      while (i < n && !isWs(str[i]) && !isDelim(str[i])) { name += str[i]; i++; }
      toks.push({ t: "name", v: name });
      continue;
    }
    if ((c >= "0" && c <= "9") || c === "-" || c === "+" || c === ".") {
      let num = "";
      while (i < n && !isWs(str[i]) && !isDelim(str[i])) { num += str[i]; i++; }
      toks.push({ t: "num", v: parseFloat(num) || 0 });
      continue;
    }
    let op = "";
    while (i < n && !isWs(str[i]) && !isDelim(str[i])) { op += str[i]; i++; }
    toks.push({ t: "op", v: op });
  }
  return toks;
};

/** تحويل سلسلة بايتس إلى نص عبر خريطة ToUnicode الخاصة بخطها الحالي. */
const decodePdfString = (bytes: number[], font: PdfFont | null): string => {
  const cmap = font ? font.cmap : null;
  const two = font ? font.twoByte : false;
  let s = "";
  if (two) {
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      if (cmap) {
        const u = cmap.get(code);
        if (u !== undefined) s += String.fromCharCode(u);
      }
    }
  } else {
    for (const b of bytes) {
      if (cmap) {
        const u = cmap.get(b);
        if (u !== undefined) {
          s += String.fromCharCode(u);
          continue;
        }
      }
      s += String.fromCharCode(b);
    }
  }
  return s;
};

const isCombiningMark = (ch: string) => /\p{M}/u.test(ch);

/** تنفيذ أوامر النص واستخراج السطور بحسب موضع النص الفعلي. */
const runPdfContent = (str: string, fontMaps: Map<string, PdfFont>): string => {
  const toks = tokenizePdfContent(str);
  let out = "";
  const stack: PdfToken[] = [];
  let curFont: PdfFont | null = null;
  let curY: number | null = null;
  let lastY: number | null = null;
  let leading = 12;
  let fontSize = 12;

  const pushText = (bytes: number[]) => {
    const s = decodePdfString(bytes, curFont);
    if (!s) return;
    // علامات التشكيل تُرسم عند موضع مرفوع — لا تكسر السطر ولا تُحدّد موقعه
    const markOnly = Array.from(s).every((ch) => isCombiningMark(ch));
    if (!markOnly) {
      const sameLine = lastY !== null && curY !== null && Math.abs(curY - lastY) <= 0.6 * fontSize;
      if (curY !== null && !sameLine) {
        if (out.length && !out.endsWith("\n")) out += "\n";
        lastY = curY;
      }
    }
    out += s;
  };

  let dictDepth = 0;
  for (const tk of toks) {
    if (tk.t === "do") { dictDepth++; stack.push(tk); continue; }
    if (tk.t === "dc") {
      dictDepth--;
      while (stack.length && stack[stack.length - 1].t !== "do") stack.pop();
      stack.pop();
      continue;
    }
    if (tk.t !== "op") { stack.push(tk); continue; }
    if (dictDepth > 0) continue;

    const op = tk.v;
    const top = (k: number) => stack[stack.length - k];
    switch (op) {
      case "BT":
        curY = 0;
        lastY = null;
        break;
      case "ET":
        curY = null;
        lastY = null;
        break;
      case "TL": {
        const t = top(1);
        if (t && t.t === "num") leading = t.v;
        break;
      }
      case "Tf": {
        if (stack.length >= 2) {
          const fname = top(2);
          const fsize = top(1);
          if (fname && fname.t === "name") curFont = fontMaps.get(fname.v) || null;
          if (fsize && fsize.t === "num" && fsize.v) fontSize = fsize.v;
        }
        break;
      }
      case "Td":
      case "TD": {
        if (stack.length >= 2) {
          const ty = top(1);
          if (ty && ty.t === "num") {
            if (op === "TD") leading = -ty.v;
            if (curY !== null) curY = curY + ty.v;
          }
        }
        break;
      }
      case "Tm": {
        if (stack.length >= 6) {
          const f = top(1);
          if (f && f.t === "num") curY = f.v;
        }
        break;
      }
      case "T*":
        if (curY !== null) curY = curY - leading;
        break;
      case "Tj": {
        const t = top(1);
        if (t && t.t === "str") pushText(t.v);
        break;
      }
      case "'":
        if (curY !== null) curY = curY - leading;
        {
          const t = top(1);
          if (t && t.t === "str") pushText(t.v);
        }
        break;
      case '"': {
        if (stack.length >= 3) {
          const aw = top(3);
          if (aw && aw.t === "num") leading = aw.v;
          if (curY !== null) curY = curY - leading;
          const t = top(1);
          if (t && t.t === "str") pushText(t.v);
        }
        break;
      }
      case "TJ": {
        const t = top(1);
        if (t && t.t === "ac") {
          let idx = stack.length - 2;
          const items: PdfToken[] = [];
          while (idx >= 0 && stack[idx].t !== "ao") {
            items.unshift(stack[idx]);
            idx--;
          }
          for (const it of items) if (it.t === "str") pushText(it.v);
        }
        break;
      }
      default:
        break;
    }
    stack.length = 0;
  }
  return out;
};

/*--------------------- معالجة الاتجاه العربي في النص ---------------------*/

const isRtlChar = (ch: string): boolean => {
  const c = ch.codePointAt(0) || 0;
  return (
    (c >= 0x0590 && c <= 0x08ff) || // عبري/عربي ونطاقاته
    (c >= 0xfb1d && c <= 0xfdff) ||
    (c >= 0xfe70 && c <= 0xfeff) // الأشكال العرضية للحروف العربية
  );
};

/** عكس سطر مخزناً بالترتيب البصري: الوحدة = حرف + علاماته الملتصقة. */
const reverseRtlLine = (line: string): string => {
  const units: Array<{ base: string; marks: string }> = [];
  for (const ch of line) {
    if (isCombiningMark(ch)) {
      const last = units[units.length - 1];
      if (last && last.base) last.marks += ch;
      else if (last) last.marks += ch;
      else units.push({ base: "", marks: ch });
      continue;
    }
    const last = units[units.length - 1];
    if (last && !last.base && last.marks) last.base = ch; // علامة قبل حرفها (بصري معكوس)
    else units.push({ base: ch, marks: "" });
  }
  return units
    .map((u) => u.base + u.marks)
    .reverse()
    .join("");
};

/** عكس الأسطر العربية وتوحيد الأشكال العرضية + إهمال محارف التحكم. */
const fixPdfRtlText = (text: string): string =>
  text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .split("\n")
    .map((line) => {
      let rtl = 0;
      let total = 0;
      for (const ch of line) {
        if (/\s/.test(ch)) continue;
        total++;
        if (isRtlChar(ch)) rtl++;
      }
      const out = rtl > 0 && rtl * 3 >= total ? reverseRtlLine(line) : line;
      return out.normalize("NFKC");
    })
    .join("\n");

/*--------------------------- شجرة الصفحات ---------------------------*/

const findPdfPages = (byNum: Map<number, PdfObject>): number[] => {
  for (const o of byNum.values()) {
    if (/\/Type\s*\/Pages(?![a-zA-Z])/.test(o.dictText)) {
      const km = o.dictText.match(/\/Kids\s*\[([\s\S]*?)\]/);
      if (km) {
        const refs = km[1].match(/\d+\s+\d+\s+R/g) || [];
        const nums = refs.map((r) => parseInt(r, 10)).filter((x) => !isNaN(x));
        if (nums.length) return nums;
      }
    }
  }
  const fallback: number[] = [];
  for (const o of byNum.values()) {
    if (/\/Type\s*\/Page(?![a-zA-Z])/.test(o.dictText)) fallback.push(o.num);
  }
  return fallback;
};

/*------------------------------------------------------------------------------
  قراءة ملف PDF واستخراج نصه بالكامل (بلا أي مكتبة خارجية).
------------------------------------------------------------------------------*/

async function readPdfFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  if (decodePdfBytes(data.slice(0, 5)) !== "%PDF-") {
    throw new Error("الملف ليس صيغة PDF صالحة.");
  }

  const objs = scanPdfObjects(data).map((o) => loadPdfObject(data, o));
  const extras = await expandObjStreams(objs);
  const byNum = new Map<number, PdfObject>();
  for (const o of objs) byNum.set(o.num, o);
  for (const o of extras) if (!byNum.has(o.num)) byNum.set(o.num, o);

  const kids = findPdfPages(byNum);
  const pageTexts: string[] = [];

  for (const pageNum of kids) {
    const page = byNum.get(pageNum);
    if (!page) continue;
    const fontMaps = await buildPdfFontMaps(page.dictText, byNum);

    // /Contents: إحالة واحدة أو مصفوفة تدفقات
    const contentNums: number[] = [];
    const cRef = page.dictText.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
    if (cRef) contentNums.push(+cRef[1]);
    const cArr = page.dictText.match(/\/Contents\s*\[([\s\S]*?)\]/);
    if (cArr) {
      for (const r of cArr[1].match(/\d+\s+\d+\s+R/g) || []) contentNums.push(parseInt(r, 10));
    }

    let pageText = "";
    for (const cn of contentNums) {
      const co = byNum.get(cn);
      if (!co || !co.streamBytes) continue;
      let bytes: Uint8Array<ArrayBuffer> = co.streamBytes;
      if (co.flate) {
        try {
          bytes = await inflateZlib(co.streamBytes);
        } catch {
          continue;
        }
      }
      pageText += runPdfContent(decodePdfBytes(bytes), fontMaps) + "\n";
    }
    if (pageText.trim()) pageTexts.push(pageText.trim());
  }

  const joined = fixPdfRtlText(pageTexts.join("\n")).trim();
  if (joined.length === 0) {
    throw new Error(
      "لم يتم العثور على نص في ملف الـ PDF.
السبب الأرجح: الملف ممسوح ضوئياً (صور صفحات فقط) فلا يحتوي نصاً قابلاً للقراءة.
الحل: انسخ نص الأسئلة من الملف يدوياً والصقه في مربع النص أدناه، أو احفظه كملف Word (.docx) أو نص (.txt) ثم استورده من هنا."
    );
  }
  return joined;
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


