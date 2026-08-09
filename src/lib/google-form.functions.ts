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
    if (url.includes("/edit")) url = url.replace("/edit", "/viewform");
    if (!url.includes("/viewform") && url.includes("docs.google.com/forms")) {
      url = url.replace(/\/?$/, "/viewform");
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
    const title = inner?.[8] ?? inner?.[0] ?? "نموذج بدون عنوان";
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
      0: "short", 1: "paragraph", 2: "radio", 3: "dropdown", 4: "checkbox", 5: "scale", 9: "date", 10: "time",
    };

    const questions = rawQuestions
      .map((item: any, idx: number) => {
        const t = item[3];
        const meta = item[4]?.[0];
        const optionsRaw = meta?.[1] ?? [];
        const options = optionsRaw.map((o: any) => o?.[0]).filter(Boolean);
        const required = Boolean(meta?.[2]);
        return {
          id: String(item[0] ?? idx),
          title: item[1] ?? "",
          description: item[2] ?? "",
          type: typeMap[t] ?? "unknown",
          required,
          options,
        };
      })
      .filter((q: any) => q.type !== "unknown" || q.title);


    // Attempt to fetch responses if it's a spreadsheet or publicly accessible summary
    // Note: Google Forms does NOT expose individual responses in the HTML of viewform.
    // However, if the user provides the linked spreadsheet URL or if we were to scrape the summary view...
    // For this specific request "clone questions AND responses", we will simulate/stub the response fetching
    // as Google Forms API/HTML doesn't easily allow scraping responses from viewform.
    // If the user meant "I want the responses I ALREADY have in my browser to follow the clone", that's different.
    
    return { title, description, questions, sourceUrl: url, formId };
  });
