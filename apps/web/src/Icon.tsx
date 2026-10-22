export type IconName = "work" | "materials" | "plan" | "experiments" | "results" | "manuscript" | "review" | "settings" | "panel" | "close" | "pin" | "compare" | "chevron" | "plus" | "send" | "refresh" | "chat" | "logo";
const paths: Record<IconName, string> = {
  work: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  materials: "M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1z M12 5v15",
  plan: "M8 3h8v4H8z M8 5H5v16h14V5h-3 M8 11h8 M8 15h5",
  experiments: "M9 3h6 M10 3v7L4 20c-.3.5 0 1 1 1h14c1 0 1.3-.5 1-1l-6-10V3 M7 15h10",
  results: "M4 3v18h17 M8 16l4-6 4 3 5-7",
  manuscript: "M14 3H5v18h14V8z M14 3v5h5 M8 12h8 M8 16h6",
  review: "M4 4h16v13H9l-5 4z M8 8h8 M8 12h5",
  settings: "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  panel: "M3 4h18v16H3z M9 4v16",
  close: "M6 6l12 12 M18 6L6 18",
  pin: "M9 3h6l-1 6 4 4v2H6v-2l4-4z M12 15v6",
  compare: "M3 4h18v16H3z M12 4v16",
  chevron: "M8 5l7 7-7 7",
  plus: "M12 5v14 M5 12h14",
  send: "M12 20V4 M5 11l7-7 7 7",
  refresh: "M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 13-3l2 3 M4 16l2 3a8 8 0 0 0 13-3",
  chat: "M3 4h18v13H8l-5 4z M7 8h10 M7 12h6",
  logo: "M3 7l9-5 9 5-9 5z M3 12l9 5 9-5 M3 17l9 5 9-5",
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
