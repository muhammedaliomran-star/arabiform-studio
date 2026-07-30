import { useCallback, useEffect, useRef, useState } from "react";
import type { Store } from "@/lib/form-types";
import { loadStore, saveStore } from "@/lib/form-storage";

const LIMIT = 50;

export function useFormsStore() {
  const [store, setStore] = useState<Store>({ forms: [], responses: {} });
  const [hydrated, setHydrated] = useState(false);
  const past = useRef<Store[]>([]);
  const future = useRef<Store[]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    setStore(loadStore());
    setHydrated(true);
  }, []);

  const commit = useCallback((next: Store, recordHistory = true) => {
    setStore((prev) => {
      if (recordHistory) {
        past.current = [...past.current, prev].slice(-LIMIT);
        future.current = [];
      }
      saveStore(next);
      return next;
    });
    force((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    setStore((prev) => {
      const last = past.current[past.current.length - 1];
      if (!last) return prev;
      past.current = past.current.slice(0, -1);
      future.current = [prev, ...future.current].slice(0, LIMIT);
      saveStore(last);
      return last;
    });
    force((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    setStore((prev) => {
      const next = future.current[0];
      if (!next) return prev;
      future.current = future.current.slice(1);
      past.current = [...past.current, prev].slice(-LIMIT);
      saveStore(next);
      return next;
    });
    force((n) => n + 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    store,
    hydrated,
    commit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
