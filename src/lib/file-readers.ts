/** قراءة ملف نصي (txt) من المتصفح دون رفعه لأي جهة. */
export async function readTextFile(file: File): Promise<string> {
  const text = await file.text();
  return text;
}

/** ملحقات تُقرأ مباشرة في المتصفح (نص + PDF + Word .docx و .doc القديم). */
const DIRECT_EXTENSIONS = [".txt", ".md", ".pdf", ".docx", ".doc"];

/** ملحقات لا تزال تحتاج تحويلاً خارجياً (RTF). */
export const REQUIRES_CONVERSION = [".rtf"];

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

  // التمييز الأصفر (الإجابة الصحيحة) يأتي في Word بثلاث صور:
  // 1) تمييز على النص نفسه <w:highlight w:val="yellow"/>
  // 2) تعبئة خلفية <w:shd> على مستوى الحرف أو الفقرة
  // 3) تعبئة خلفية الخلية في الجدول <w:tcPr><w:shd .../>
  // نقبل فقط الأصباغ الصفراء الحقيقية (لا البرتقالية/الكريمية المستخدمة للزينة).
  const YELLOW_SHD_RE = /<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/i;
  const isYellowFill = (hex: string): boolean => {
    const n = parseInt(hex, 16);
    if (isNaN(n)) return false;
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return r >= 200 && g >= 180 && b < 200 && r - b >= 40;
  };
  const hasYellowShading = (frag: string): boolean => {
    const m = frag.match(YELLOW_SHD_RE);
    return m ? isYellowFill(m[1]) : false;
  };

  // نمشي على المستند بتسلسله: خلايا الجدول تفتح نطاقات تظليل يرثه ما بداخلها.
  // نجمع التوكنات أولاً حتى تكون حدود كل فقرة معلومة (الفقرات ذاتية الإغلاق
  // <w:p .../> لا تحوي </w:p> ولا يجوز أن يمتد البحث خلفها إلى فقرة تالية).
  const tokens: RegExpExecArray[] = [];
  const tokenRe = /<w:tc[\s>]|<\/w:tc[\s>]|<w:p[\s>]/g;
  let tk: RegExpExecArray | null;
  while ((tk = tokenRe.exec(xml)) !== null) tokens.push(tk);

  const lines: string[] = [];
  const cellStack: boolean[] = [];
  for (let ti = 0; ti < tokens.length; ti++) {
    const tm = tokens[ti];
    const tok = tm[0];
    if (tok.startsWith("</w:tc")) {
      if (cellStack.length) cellStack.pop();
      continue;
    }
    if (tok.startsWith("<w:tc")) {
      // <w:tcPr> يلي <w:tc> مباشرة ويتوقف عند أول فقرة
      const prEnd = xml.indexOf("</w:tcPr>", tm.index);
      const firstP = xml.indexOf("<w:p", tm.index);
      let headEnd = prEnd >= 0 ? prEnd + 9 : tm.index + 1500;
      if (firstP >= 0 && firstP < headEnd) headEnd = firstP;
      cellStack.push(hasYellowShading(xml.slice(tm.index, headEnd)));
      continue;
    }

    // فقرة كاملة: نستخرج نصوص حروفها ثم نقرر تظليلها.
    // الحدود: أول </w:p> أو بداية التوكن التالي أيهما أقرب.
    const paraStart = tm.index + tok.length;
    const nextIdx = ti + 1 < tokens.length ? tokens[ti + 1].index : xml.length;
    let paraEnd = xml.indexOf("</w:p>", paraStart);
    if (paraEnd < 0 || nextIdx < paraEnd) paraEnd = nextIdx;
    const paraContent = xml.slice(paraStart, paraEnd);

    const parts: string[] = [];
    const runRe = /<w:r[\s>]([\s\S]*?)<\/w:r>/g;
    let rm: RegExpExecArray | null;
    while ((rm = runRe.exec(paraContent)) !== null) {
      const runContent = rm[1];
      const isHighlighted =
        /<w:highlight[^>]*w:val="yellow"/i.test(runContent) || hasYellowShading(runContent);
      const tMatch = runContent.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
      const text = tMatch ? decodeXml(tMatch[1]) : "";
      if (text.length === 0) continue;
      if (isHighlighted) {
        parts.push("[[HL]]" + text + "[[/HL]]");
      } else {
        parts.push(text);
      }
    }

    // تظليل الفقرة نفسها <w:pPr><w:shd .../> يغطي كل نصها.
    const pPrIdx = paraContent.indexOf("<w:pPr");
    const pPrEnd = paraContent.indexOf("</w:pPr>");
    const paraShaded =
      pPrIdx >= 0 && pPrEnd > pPrIdx && hasYellowShading(paraContent.slice(pPrIdx, pPrEnd + 9));

    let line = parts.join("").trim();
    if ((paraShaded || cellStack.some((v) => v)) && line) line = "[[HL]]" + line + "[[/HL]]";
    lines.push(line);
  }
  const joined = lines.join("\n");
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
      "لم يتم العثور على نص في ملف الـ PDF. السبب الأرجح: الملف ممسوح ضوئياً (صور صفحات فقط) فلا يحتوي نصاً قابلاً للقراءة. الحل: انسخ نص الأسئلة من الملف يدوياً والصقه في مربع النص أدناه، أو احفظه كملف Word (.docx) أو نص (.txt) ثم استورده من هنا.",
    );
  }
  return joined;
}


/*==============================================================================
  قراءة ملف Word .doc القديم (97-2003) محلياً في المتصفح.
  بنية الملف: حاوية OLE/CFB تحوي تدفقَي WordDocument و 1Table/0Table.
  نحلل جدول القطع (Piece Table) من بنية Clx ونستخرج النص قطعةً قطعة:
  القطع المضغوطة 8 بت ترميزها windows-1256 (عربي) والغير مضغوطة UTF-16LE.
==============================================================================*/

const CFB_ENDOFCHAIN = 0xfffffffe;
const CFB_FREESECT = 0xffffffff;

/** متابعة سلسلة قطاعات من جدول FAT/MiniFAT. */
function cfbChain(fat: Uint32Array, start: number, maxSteps: number): number[] {
  const chain: number[] = [];
  const visited = new Set<number>();
  let sec = start;
  while (
    sec !== CFB_ENDOFCHAIN &&
    sec !== CFB_FREESECT &&
    sec < fat.length &&
    !visited.has(sec) &&
    chain.length < maxSteps
  ) {
    visited.add(sec);
    chain.push(sec);
    sec = fat[sec];
  }
  return chain;
}

/** تجميع محتوى سلسلة قطاعات في مصفوفة بايتات واحدة. */
function cfbReadSectors(
  data: Uint8Array,
  chain: number[],
  sectorSize: number,
  headerSize: number,
): Uint8Array {
  const out = new Uint8Array(chain.length * sectorSize);
  for (let i = 0; i < chain.length; i++) {
    const off = headerSize + chain[i] * sectorSize;
    if (off < 0 || off + sectorSize > data.length) break;
    out.set(data.subarray(off, off + sectorSize), i * sectorSize);
  }
  return out;
}

/** جدول ترميز windows-1256 (المستخدم في ملفات الوورد العربية القديمة). */
let cp1256Cache: string[] | null = null;
function cp1256Char(b: number): string {
  if (!cp1256Cache) {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    cp1256Cache = Array.from(new TextDecoder("windows-1256").decode(bytes));
  }
  return cp1256Cache[b] ?? "";
}

/** استخراج نص من ملف RTF بسيط (أحياناً يُحفظ بإمتداد .doc). */
function extractRtfText(raw: string): string {
  return raw
    .replace(/\\'([0-9a-fA-F]{2})/g, (_m, h) => cp1256Char(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\s*\?/g, (_m, d) =>
      String.fromCharCode(((parseInt(d, 10) % 65536) + 65536) % 65536),
    )
    .replace(/\\par[d]?\s?/g, "\n")
    .replace(/\\tab\s?/g, "\t")
    .replace(/\\\*/g, "")
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
    .replace(/[{}]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** تنظيف نص .doc: فواصل الفقرات/الخلايا + حذف رموز التحكم الداخلية. */
function cleanupDocText(s: string): string {
  return s
    .replace(/\r/g, "\n")
    .replace(/[\u0007\u000B\u000C]/g, "\n") // نهاية خلية جدول/سطر/قسم
    .replace(/[\u0000-\u0006\u0008\u000E-\u001F\uFFFD]/g, "") // رموز حقول وصور وغيرها
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** استخراج نص ملف .doc من تدفقَي WordDocument و Table. */
function extractDocText(word: Uint8Array, table: Uint8Array): string {
  const pieces: { off: number; cnt: number; compressed: boolean }[] = [];

  // fcClx/lcbClx في رأس FIB (إزاحات ثابتة في Word 97+)
  if (word.length >= 0x1a6 + 4) {
    const fcClx = readU32(word, 0x1a2);
    const lcbClx = readU32(word, 0x1a6);
    if (lcbClx > 0 && lcbClx <= table.length && fcClx + lcbClx <= table.length) {
      const clx = table.subarray(fcClx, fcClx + lcbClx);
      let p = 0;
      while (p < clx.length) {
        const t = clx[p];
        if (t === 1) {
          if (p + 3 > clx.length) break;
          p += 3 + readU16(clx, p + 1); // Prc: نتخطاها
        } else if (t === 2) {
          // Pcdt: جدول القطع
          if (p + 5 > clx.length) break;
          const lcb = readU32(clx, p + 1);
          const plc = clx.subarray(p + 5, Math.min(p + 5 + lcb, clx.length));
          const n = Math.floor((plc.length - 4) / 12);
          for (let i = 0; i < n; i++) {
            const cpEnd = readU32(plc, i * 4 + 4);
            const cpStart = readU32(plc, i * 4);
            const fcRaw = readU32(plc, (n + 1) * 4 + i * 8 + 2);
            const compressed = (fcRaw & 0x40000000) !== 0;
            const fc = fcRaw & 0x3fffffff;
            const cnt = Math.max(0, cpEnd - cpStart);
            if (cnt > 0) {
              pieces.push({ off: compressed ? Math.floor(fc / 2) : fc, cnt, compressed });
            }
          }
          break;
        } else break;
      }
    }
  }

  const parts: string[] = [];
  let usedTable = false;
  for (const pc of pieces) {
    const byteLen = pc.compressed ? pc.cnt : pc.cnt * 2;
    if (pc.off < 0 || pc.off + byteLen > word.length) continue;
    usedTable = true;
    const bytes = word.subarray(pc.off, pc.off + byteLen);
    parts.push(pc.compressed ? new TextDecoder("windows-1256").decode(bytes) : new TextDecoder("utf-16le").decode(bytes));
  }

  // احتياط: إن تعذر تحليل جدول القطع نجرب قراءة التدفق كاملاً بالترميزين
  // ونختار الأفضل، ثم نحذف الأسطر التي تبدو بيانات تنسيق لا نصاً.
  if (!usedTable || parts.join("").replace(/\s/g, "").length < 10) {
    const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F]/;
    const score = (s: string): number => (s.match(/[\u0600-\u06FF]/g) ?? []).length;
    const u16 = new TextDecoder("utf-16le").decode(word);
    const a8 = new TextDecoder("windows-1256").decode(word);
    const best = score(u16) >= score(a8) ? u16 : a8;
    const lines = best
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) =>
        line
          .split("")
          .filter((ch) => ch === "\t" || ch === "\u0007" || /[\u0020-\u007E\u0600-\u06FF\u2010-\u2027]/.test(ch))
          .join(""),
      )
      .filter((line) => {
        const t = line.trim();
        if (!t) return false;
        const printable = (t.match(/[A-Za-z\u0600-\u06FF0-9]/g) ?? []).length;
        return printable / t.length >= 0.5;
      });
    return cleanupDocText(lines.join("\n"));
  }

  return cleanupDocText(parts.join(""));
}

/** قراءة ملف Word .doc (97-2003) عبر تحليل حاوية OLE/CFB في المتصفح. */
async function readDocFile(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());

  // التوقيع D0 CF 11 E0 A1 B1 1A E1 — وإن لم يوجد فربما نص/RTF/HTML بإمتداد .doc
  const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const isOle = data.length >= 512 && SIG.every((b, i) => data[i] === b);

  if (!isOle) {
    const head = new TextDecoder("windows-1252").decode(data.subarray(0, 4096));
    if (/^\s*\{\s*\\rtf/i.test(head)) {
      const text = cleanupDocText(extractRtfText(new TextDecoder("windows-1252").decode(data)));
      if (text.replace(/\s/g, "").length > 0) return text;
    }
    if (/^\s*<(!doctype|html)/i.test(head)) {
      const html = new TextDecoder("utf-8").decode(data);
      const text = cleanupDocText(
        html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]*>/g, "\n")
          .replace(/&nbsp;/g, " "),
      );
      if (text.replace(/\s/g, "").length > 0) return text;
    }
    throw new Error(
      "تعذر قراءة هذا الملف بامتداد .doc. إن كان ملف وورد فعلياً فافتحه في وورد واحفظه بصيغة \"مستند Word (.docx)\" ثم استورده من هنا، أو انسخ النص والصقه في المربع أدناه.",
    );
  }

  const sectorSize = 1 << data[0x1e];
  const headerSize = 512; // رأس v3 ثابت حتى مع قطاعات أكبر
  const fatCount = readU32(data, 0x2c);
  const dirStart = readU32(data, 0x30);
  const miniCutoff = readU32(data, 0x38);
  const miniFatStart = readU32(data, 0x3c);
  const miniFatCount = readU32(data, 0x40);
  const difatStart = readU32(data, 0x44);

  // DIFAT: أول 109 مداخل في الرأس ثم قطاعات DIFAT متسلسلة
  const fatSectorIds: number[] = [];
  for (let i = 0; i < 109; i++) {
    const id = readU32(data, 0x4c + i * 4);
    if (id !== CFB_ENDOFCHAIN && id !== CFB_FREESECT) fatSectorIds.push(id);
  }
  let difatSec = difatStart;
  const seenDifat = new Set<number>();
  while (
    difatSec !== CFB_ENDOFCHAIN &&
    difatSec !== CFB_FREESECT &&
    !seenDifat.has(difatSec) &&
    fatSectorIds.length < fatCount
  ) {
    seenDifat.add(difatSec);
    const off = headerSize + difatSec * sectorSize;
    if (off + sectorSize > data.length) break;
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per; i++) {
      const id = readU32(data, off + i * 4);
      if (id !== CFB_ENDOFCHAIN && id !== CFB_FREESECT) fatSectorIds.push(id);
    }
    difatSec = readU32(data, off + sectorSize - 4);
  }

  // FAT
  const perSector = sectorSize / 4;
  const fat = new Uint32Array(fatSectorIds.length * perSector);
  fatSectorIds.forEach((id, i) => {
    const off = headerSize + id * sectorSize;
    if (off + sectorSize > data.length) return;
    for (let j = 0; j < perSector; j++) fat[i * perSector + j] = readU32(data, off + j * 4);
  });

  // الدليل (Directory) — مدخل 128 بايت لكل تدفق
  const dirData = cfbReadSectors(data, cfbChain(fat, dirStart, 100000), sectorSize, headerSize);
  type DirEntry = { name: string; type: number; start: number; size: number };
  const entries: DirEntry[] = [];
  for (let off = 0; off + 128 <= dirData.length; off += 128) {
    const nameLen = readU16(dirData, off + 0x40);
    if (nameLen < 2 || nameLen > 64) continue;
    const name = new TextDecoder("utf-16le").decode(dirData.subarray(off, off + nameLen - 2));
    entries.push({
      name,
      type: dirData[off + 0x42],
      start: readU32(dirData, off + 0x74),
      size: readU32(dirData, off + 0x78),
    });
  }

  const root = entries.find((e) => e.type === 5);
  const miniContainer = root
    ? cfbReadSectors(data, cfbChain(fat, root.start, 100000), sectorSize, headerSize).subarray(0, root.size)
    : new Uint8Array(0);

  const miniFatU32 = new Uint32Array(miniFatCount * perSector);
  if (miniFatCount > 0 && miniFatStart !== CFB_ENDOFCHAIN && miniFatStart !== CFB_FREESECT) {
    const miniFatData = cfbReadSectors(data, cfbChain(fat, miniFatStart, 100000), sectorSize, headerSize);
    for (let i = 0; i < miniFatU32.length; i++) {
      if (i * 4 + 4 > miniFatData.length) break;
      miniFatU32[i] = readU32(miniFatData, i * 4);
    }
  }

  const readEntry = (e: DirEntry): Uint8Array => {
    if (e.size < miniCutoff) {
      return cfbReadSectors(data, cfbChain(fat, e.start, 100000), sectorSize, headerSize).subarray(0, e.size);
    }
    const chain = cfbChain(miniFatU32, e.start, 100000);
    const out = new Uint8Array(chain.length * 64);
    chain.forEach((s, i) => {
      const from = s * 64;
      if (from + 64 <= miniContainer.length) out.set(miniContainer.subarray(from, from + 64), i * 64);
    });
    return out.subarray(0, e.size);
  };

  const wordEntry = entries.find((e) => e.type === 2 && e.name.toLowerCase() === "worddocument");
  if (!wordEntry) {
    throw new Error(
      "هذا الملف بصيغة .doc لا يحتوي على بيانات وورد قابلة للقراءة. افتحه في وورد واحفظه بصيغة \"مستند Word (.docx)\" ثم استورده من هنا.",
    );
  }

  const wordData = readEntry(wordEntry);
  const encrypted = (wordData[0x0b] & 0x01) !== 0;
  if (encrypted) {
    throw new Error(
      "ملف الوورد محمي بكلمة مرور فلا يمكن قراءته. افتحه في وورد واحفظه بصيغة \"مستند Word (.docx)\" بدون حماية ثم استورده من هنا.",
    );
  }

  const fWhichTblStm = (wordData[0x0b] & 0x02) !== 0;
  const tblName = fWhichTblStm ? "1table" : "0table";
  const tblEntry =
    entries.find((e) => e.type === 2 && e.name.toLowerCase() === tblName) ??
    entries.find((e) => e.type === 2 && /^0?1?table$/i.test(e.name));
  const tableData = tblEntry ? readEntry(tblEntry) : new Uint8Array(0);

  const text = extractDocText(wordData, tableData);
  if (text.replace(/\s/g, "").length > 0) return text;

  throw new Error(
    "لم نتمكن من استخراج نص من هذا الملف (.doc). افتحه في وورد واحفظه بصيغة \"مستند Word (.docx)\" أو \"نص عادي (.txt)\" ثم استورده من هنا، أو انسخ النص والصقه في المربع أدناه.",
  );
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
  if (ext === ".doc") {
    return readDocFile(file);
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
    return `الملف "${file.name}" من نوع ${ext.toUpperCase()} يحتاج تحويلاً قبل الاستيراد. اختر أحد الخيارين:
1. افتح الملف في وورد ثم احفظه بصيغة "نص عادي (.txt)" أو "مستند Word (.docx)" واستورده من هنا.
2. انسخ محتوى الملف والصقه في مربع النص أدناه واستورد من النص مباشرة.`;
  }
  return `نوع الملف "${ext}" غير مدعوم للاستيراد النصي.`;
}


