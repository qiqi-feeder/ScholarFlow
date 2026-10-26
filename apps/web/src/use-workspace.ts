import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readStored, writeStored } from "./workspace";
export const storageWarning = (message: string) => {
  setTimeout(() => window.dispatchEvent(new CustomEvent("workspace-warning", { detail: message })), 0);
};
export function useStoredState<T>(key: string, initial: T, valid: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>] {
  const memory = useRef(new Map<string, T>());
  const restored = useMemo(() => {
    if (memory.current.has(key)) return memory.current.get(key)!;
    try { return readStored(localStorage, key, initial, valid, storageWarning); }
    catch { storageWarning("浏览器存储已禁用，工作现场仅保留在内存中。"); return initial; }
  }, [key]);
  const [entry, setEntry] = useState({ key, value: restored });
  const value = entry.key === key ? entry.value : restored;
  const update: Dispatch<SetStateAction<T>> = (action) => {
    setEntry((previous) => {
      const before = memory.current.get(key) ?? (previous.key === key ? previous.value : restored);
      const next = typeof action === "function" ? (action as (value: T) => T)(before) : action;
      memory.current.set(key, next);
      try { writeStored(localStorage, key, next, storageWarning); } catch { storageWarning("浏览器存储已禁用，草稿仍保留在内存中。"); }
      return { key, value: next };
    });
  };
  return [value, update];
}
export const isString = (v: unknown): v is string => typeof v === "string";
export function sameShape<T extends Record<string, string>>(initial: T) {
  return (v: unknown): v is T => !!v && typeof v === "object" && Object.keys(initial).every((key) => typeof (v as Record<string, unknown>)[key] === "string");
}
