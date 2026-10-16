import { createServerFn } from "@tanstack/react-start";

export type ScoreItem = {
  /** Google item id (matches Question.gid) */
  gid: string;
  earned: number;
  total: number;
  /** correct option text, when shown */
  correct?: string;
  /** respondent's own answer */
  respondent?: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

const clean = (v: string) => decodeEntities(v.replace(/<[^>]*>/g, "")).trim();

export const fetchGoogleScore = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof (data as { url?: unknown }).url !== "string") {
      throw new Error("رابط غير صالح");
    }
    return { url: (data as { url: string }).url };
  })
  .handler(async ({ data }): Promise<{ items: ScoreItem[] }> => {
    const url = data.url.trim();
    if (!/docs\.google\.com\/forms\/.+viewscore/.test(url)) {
      throw new Error("رابط النتيجة غير صالح — افتح نتيجة المحاولة وانسخ رابط «عرض النتيجة».");
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "ar,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`تعذر الوصول إلى صفحة النتيجة (${res.status})`);
    const html = await res.text();

    // كل سؤال مُصحَّح له بلوك: <div class="RGoode" id="i.points.GID" ...>EARNED/TOTAL</div>
    // (قد تليه خصائص إضافية role/aria-label لذلك لا نطلب إغلاق الوسم مباشرة)
    const marks: Array<{ gid: string; earned: number; total: number; idx: number }> = [];
    const re = /<div class="RGoode" id="i\.points\.(\d+)"[^>]*>(\d+)\/(\d+)<\/div>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      marks.push({ gid: m[1], earned: Number(m[2]), total: Number(m[3]), idx: m.index });
    }
    if (!marks.length) {
      throw new Error(
        "تعذر قراءة النتيجة — تأكد أن الرابط يعرض الدرجات والإجابات الصحيحة بدون تسجيل دخول.",
      );
    }

    const items: ScoreItem[] = marks.map((mk, i) => {
      const seg = html.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : html.length);
      const resp = seg.match(/data-value="([^"]+)"/);
      const respondent = resp ? clean(resp[1]) : undefined;
      let correct: string | undefined;
      const keyIdx = seg.indexOf("الإجابة الصحيحة");
      if (keyIdx >= 0) {
        // السؤال أُجيب خطأ: نص الخيار الصحيح في أول span.aDTYNe بعد بلوك التصحيح
        const after = seg.slice(keyIdx);
        const cm = after.match(/<span dir="auto" class="aDTYNe[^"]*">([^<]+)<\/span>/);
        if (cm) correct = clean(cm[1]);
      } else if (seg.includes("إجابة صحيحة")) {
        // السؤال أُجيب صح: الصحيحة = إجابة المجيب نفسها
        correct = respondent;
      }
      return { gid: mk.gid, earned: mk.earned, total: mk.total, correct, respondent };
    });

    return { items };
  });
