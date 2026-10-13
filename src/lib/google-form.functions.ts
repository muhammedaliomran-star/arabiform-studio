import { createServerFn } from "@tanstack/react-start";

export const fetchGoogleForm = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof (data as { url?: unknown }).url !== "string") {
      throw new Error("رابط غير صالح");
    }
    return { url: (data as { url: string }).url };
  })
  .handler(async ({ data }) => {
    let url = data.url.trim();
    const m = url.match(/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]+)/);
    if (m) {
      url = `https://docs.google.com/forms/d/${m[1] ?? ""}${m[2]}/viewform`;
    } else if (!/forms\.gle\//.test(url)) {
      throw new Error("الرابط ليس رابط نموذج جوجل صالح.");
    }

    // Attempt to find linked spreadsheet for responses if the URL is an edit URL
    // or try to find a public summary link. 
    // Since scraping private responses without OAuth is impossible, we'll focus on the data structure.
    
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "ar,en;q=0.9",
      },
    });

    if (!res.ok) throw new Error(`تعذر الوصول إلى النموذج (${res.status})`);
    
    const html = await res.text();
    const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
    if (!match) throw new Error("لم يتم العثور على بيانات النموذج. تأكد أن الرابط عام.");

    let parsed: any;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      throw new Error("فشل قراءة بيانات النموذج.");
    }

    const inner = parsed[1];
    // العنوان قد يكون في inner[8] أو inner[0] أو parsed[3] حسب طريقة إنشاء النموذج
    const title = inner?.[8] ?? inner?.[0] ?? parsed[3] ?? "نموذج بدون عنوان";
    const description = inner?.[0] ?? "";
    const rawQuestions = inner?.[1] ?? [];
    
    // We'll also try to detect if a "Summary" is public
    const summaryUrl = url.replace("/viewform", "/viewanalytics");
    let responses: any[] = [];
    
    try {
        const sRes = await fetch(summaryUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (sRes.ok) {
            const sHtml = await sRes.text();
            // Google Forms analytics uses a different structure. 
            // Realistically, without API access, we can only clone the structure.
            // If the user meant "Import responses from CSV", we should add that to the UI.
        }
    } catch (e) {
        // Ignore summary fetch errors
    }

    const typeMap: Record<number, string> = {
      0: "short",
      1: "paragraph",
      2: "radio",
      3: "dropdown",
      4: "checkbox",
      5: "scale",
      6: "text",
      8: "section",
      9: "date",
      10: "time",
      11: "image",
    };

    const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const isDriveId = (v: unknown) =>
      typeof v === "string" && /^[A-Za-z0-9_-]{25,}$/.test(v) && /[A-Za-z_-]/.test(v);

    // ---------- هوية النموذج (اللون + الخط) ----------
    const toHex = (r: number, g: number, b: number) =>
      "#" +
      [r, g, b]
        .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    const mix = (rgb: [number, number, number], target: [number, number, number], t: number) =>
      toHex(
        rgb[0] + (target[0] - rgb[0]) * t,
        rgb[1] + (target[1] - rgb[1]) * t,
        rgb[2] + (target[2] - rgb[2]) * t,
      );
    let theme: { accent: string; background: string; dark: string; font: string } | undefined;
    {
      // اللون الأساسي من وسم theme-color الذي تضعه جوجل في كل نموذج ملوّن
      const tm = html.match(/<meta\s+name="theme-color"\s+content="rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)"/i);
      if (tm) {
        const accent: [number, number, number] = [Number(tm[1]), Number(tm[2]), Number(tm[3])];
        // الخط من روابط خطوط جوجل المحمّلة في الصفحة (Cairo للعربية غالباً)
        const fm =
          html.match(/fonts\.googleapis\.com\/css[^"']*?family=([A-Za-z+]+)/i) ??
          html.match(/fonts\.gstatic\.com\/[^"']*?\/([a-z]+)\/v\d+\//i);
        let font = "Cairo";
        if (fm) {
          const name = fm[1].replace(/\+/g, " ");
          if (/^(Cairo|Tajawal|Roboto|Arial|Open Sans|Noto Kufi Arabic|Noto Naskh Arabic|Amiri|Aref Ruqaa)$/i.test(name)) {
            font = name;
          }
        }
        theme = {
          accent: toHex(accent[0], accent[1], accent[2]),
          background: mix(accent, [255, 255, 255], 0.92),
          dark: mix(accent, [0, 0, 0], 0.16),
          font,
        };
      }
    }

    // صورة الترويسة: العنصر type=11 يحمل Drive ID في الخانة الخامسة
    let headerImage: string | undefined;
    const head = rawQuestions.find((item: any) => item?.[3] === 11);
    if (head && isDriveId(head[5])) headerImage = head[5] as string;

    const questions = rawQuestions
      .map((item: any, idx: number) => {
        const t = item[3];
        if (t === 11) return null; // صورة الترويسة تُحفظ على مستوى النموذج
        const meta = item[4]?.[0];
        const optionsRaw = meta?.[1] ?? [];
        const options = optionsRaw.map((o: any) => trim(o?.[0])).filter(Boolean);
        // إجابات صحيحة محتملة (تظهر في بعض النماذج) + درجات السؤال
        const correctRaw = optionsRaw
          .filter((o: any) => o?.[4] === 1 && trim(o?.[0]))
          .map((o: any) => trim(o?.[0]));
        const points = typeof meta?.[8] === "number" && meta[8] > 0 ? meta[8] : undefined;
        const required = Boolean(meta?.[2]);
        // صور السؤال: item[8] = [[driveId, null, [w,h,1]], ...]
        const images = Array.isArray(item[8])
          ? item[8].map((e: any) => e?.[0]).filter(isDriveId)
          : [];
        // قاعدة تحقق نصية: meta[4] = [[op, ?, args, message]]
        let validation: { op: number; args: string[]; message?: string } | undefined;
        if ((t === 0 || t === 1) && Array.isArray(meta?.[4]) && meta[4].length) {
          const rule = meta[4][0];
          const args = Array.isArray(rule?.[2]) ? rule[2].map((a: any) => String(a)) : [];
          if (typeof rule?.[0] === "number" && args.length) {
            validation = {
              op: rule[0],
              args,
              message: typeof rule[3] === "string" ? rule[3].trim() : undefined,
            };
          }
        }
        return {
          id: String(item[0] ?? idx),
          title: trim(item[1]),
          description: trim(item[2]),
          type: typeMap[t] ?? "unknown",
          required,
          options,
          images: images.length ? images : undefined,
          points,
          correct: correctRaw.length ? correctRaw : undefined,
          validation,
        };
      })
      .filter((q: any) => q && (q.type !== "unknown" || q.title));

    // الإجابات الصحيحة لا تُعتمد إلا إذا وُجدت درجات (إشارة وضع اختبار)،
    // وإلا تُهمل حتى لا تُبنى على تخمين — المستخدم يحددها يدوياً من المحرر.
    const hasPoints = questions.some((q: any) => q.points && q.points > 0);
    if (!hasPoints) for (const q of questions as any[]) delete q.correct;

    return {
      title: trim(title) || "نموذج بدون عنوان",
      description: trim(description),
      questions,
      sourceUrl: url,
      formId: parsed[0],
      headerImage,
      isQuiz: hasPoints,
      theme,
    };

  });
