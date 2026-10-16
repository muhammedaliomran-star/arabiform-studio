/** Max data-URL chars per uploaded image to stay exportable to Google Forms. */
export const MAX_UPLOAD_CHARS = 350000;
/** Max total data-URL chars across the whole exported script. */
export const MAX_TOTAL_UPLOAD_CHARS = 2500000;
/** Max files accepted in one batch attach. */
export const MAX_BATCH_FILES = 100;
/** Max raw file size per image before compression. */
export const MAX_RAW_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Downscale an uploaded photo (max 740px wide, JPEG) so it previews fast
 * and stays small enough to embed in the Google Apps Script export.
 */
export function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 740 / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load"));
    };
    img.src = url;
  });
}
