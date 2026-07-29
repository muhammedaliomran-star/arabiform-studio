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
    // Normalize to viewform URL
    if (url.includes("/edit")) url = url.replace("/edit", "/viewform");
    if (!url.includes("/viewform") && url.includes("docs.google.com/forms")) {
      url = url.replace(/\/?$/, "/viewform");
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "ar,en;q=0.9",
      },
    });

    if (!res.ok) {
      throw new Error(`تعذر الوصول إلى النموذج (${res.status})`);
    }
    const html = await res.text();
    const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
    if (!match) {
      throw new Error("لم يتم العثور على بيانات النموذج. تأكد أن الرابط عام.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      throw new Error("فشل قراءة بيانات النموذج.");
    }

    const arr = parsed as unknown[];
    const inner = arr[1] as unknown[];
    const title = (inner?.[8] as string) ?? (inner?.[0] as string) ?? "نموذج بدون عنوان";
    const description = (inner?.[0] as string) ?? "";
    const rawQuestions = (inner?.[1] as unknown[]) ?? [];

    type Question = {
      id: string;
      title: string;
      description: string;
      type: "short" | "paragraph" | "radio" | "checkbox" | "dropdown" | "scale" | "date" | "time" | "unknown";
      required: boolean;
      options: string[];
    };

    const typeMap: Record<number, Question["type"]> = {
      0: "short",
      1: "paragraph",
      2: "radio",
      3: "dropdown",
      4: "checkbox",
      5: "scale",
      9: "date",
      10: "time",
    };

    const questions: Question[] = rawQuestions
      .map((q, idx) => {
        const item = q as unknown[];
        const t = item[3] as number;
        const meta = (item[4] as unknown[] | undefined)?.[0] as unknown[] | undefined;
        const optionsRaw = (meta?.[1] as unknown[] | undefined) ?? [];
        const options = optionsRaw
          .map((o) => ((o as unknown[])?.[0] as string) ?? "")
          .filter(Boolean);
        const required = Boolean(meta?.[2]);
        return {
          id: String(item[0] ?? idx),
          title: (item[1] as string) ?? "",
          description: (item[2] as string) ?? "",
          type: typeMap[t] ?? "unknown",
          required,
          options,
        };
      })
      .filter((q) => q.type !== "unknown" || q.title);

    return { title, description, questions, sourceUrl: url };
  });
