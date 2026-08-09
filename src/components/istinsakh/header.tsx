import { Link } from "@tanstack/react-router";
import { Moon, Sun, Undo2, Redo2, HelpCircle } from "lucide-react";

export function Header({
  dark,
  onToggleTheme,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  dark: boolean;
  onToggleTheme: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}) {
  const iconBtn =
    "grid h-9 w-9 place-items-center rounded-full border border-border bg-surface text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-35 disabled:hover:bg-surface";

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5 md:px-8">
        <Link to="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-base font-black text-primary-foreground">
            إ
          </span>
          <span className="text-base font-extrabold leading-none tracking-tight">استنساخ</span>
        </Link>

        <div className="flex items-center gap-1.5">
          {onUndo && (
            <>
              <button onClick={onUndo} disabled={!canUndo} className={iconBtn} aria-label="تراجع (Ctrl+Z)" title="تراجع (Ctrl+Z)">
                <Undo2 className="h-4 w-4" aria-hidden />
              </button>
              <button onClick={onRedo} disabled={!canRedo} className={iconBtn} aria-label="إعادة (Ctrl+Shift+Z)" title="إعادة (Ctrl+Shift+Z)">
                <Redo2 className="h-4 w-4" aria-hidden />
              </button>
            </>
          )}
          <a href="#" className={iconBtn} aria-label="كيف يعمل؟" title="كيف يعمل؟">
            <HelpCircle className="h-4 w-4" aria-hidden />
          </a>
          <button
            onClick={onToggleTheme}
            className={iconBtn}
            aria-label={dark ? "تفعيل الوضع النهاري" : "تفعيل الوضع الليلي"}
            title={dark ? "الوضع النهاري" : "الوضع الليلي"}
          >
            {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>
    </header>
  );
}
