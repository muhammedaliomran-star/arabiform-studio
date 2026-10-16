import { useState } from "react";
import { driveFileUrl, driveImageUrl } from "@/lib/form-types";

/**
 * Google Drive image with graceful fallback: private/login-walled images
 * render a notice card (with Drive link + optional replace action)
 * instead of a broken-image icon.
 */
export function DriveImage({
  id,
  alt,
  className,
  onReplace,
}: {
  id: string;
  alt: string;
  className?: string;
  onReplace?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="mb-3 rounded-xl border border-dashed border-border bg-surface p-4 text-xs">
        <p className="font-bold text-muted-foreground">🔒 الصورة خاصة بصاحب النموذج — تعذّر عرضها تلقائياً</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <a
            href={driveFileUrl(id)}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-primary underline"
          >
            فتح الصورة في Drive
          </a>
          {onReplace && (
            <button
              onClick={onReplace}
              className="rounded-lg border border-border px-3 py-1.5 font-semibold transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              استبدال بصورة من جهازي
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <img
      src={driveImageUrl(id)}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className ?? "mb-3 max-h-64 rounded-xl border border-border"}
    />
  );
}
