export type WorkView = "work" | "materials" | "plan" | "experiments" | "results" | "manuscript" | "review" | "settings";
export interface WorkObject { kind: "material" | "plan" | "run" | "result" | "manuscript" | "review"; id: string; title: string; version?: string; pinned?: boolean }
export interface WorkspaceState {
  view: WorkView; layout: "single" | "split" | "list-detail";
  tabs: WorkObject[]; active: string | null; secondary: string | null;
  reading: Record<string, number>; selectedRunId: string | null;
}
export const objectKey = (object: WorkObject) => `${object.kind}:${object.id}`;
export const emptyWorkspace = (): WorkspaceState => ({ view: "work", layout: "single", tabs: [], active: null, secondary: null, reading: {}, selectedRunId: null });
export function validWorkspace(value: unknown): value is WorkspaceState {
  const v = value as WorkspaceState | null;
  return !!v && ["work", "materials", "plan", "experiments", "results", "manuscript", "review", "settings"].includes(v.view)
    && ["single", "split", "list-detail"].includes(v.layout) && Array.isArray(v.tabs) && v.tabs.length <= 40
    && v.tabs.every((o) => o && ["material", "plan", "run", "result", "manuscript", "review"].includes(o.kind) && typeof o.id === "string" && typeof o.title === "string")
    && new Set(v.tabs.map(objectKey)).size === v.tabs.length
    && (v.active === null || v.tabs.some((o) => objectKey(o) === v.active))
    && (v.secondary === null || v.tabs.some((o) => objectKey(o) === v.secondary))
    && !!v.reading && typeof v.reading === "object" && Object.values(v.reading).every((n) => Number.isFinite(n) && n >= 0)
    && (v.selectedRunId === null || typeof v.selectedRunId === "string");
}
export function openObject(state: WorkspaceState, object: WorkObject): WorkspaceState {
  const key = objectKey(object);
  return { ...state, active: key, tabs: [...state.tabs.filter((o) => objectKey(o) !== key), object].slice(-40),
    view: ({ material: "materials", plan: "plan", run: "experiments", result: "results", manuscript: "manuscript", review: "review" } as const)[object.kind],
    selectedRunId: object.kind === "run" ? object.id : state.selectedRunId };
}
export function closeObject(state: WorkspaceState, key: string): WorkspaceState {
  const tabs = state.tabs.filter((o) => objectKey(o) !== key);
  return { ...state, tabs, active: state.active === key ? (tabs.at(-1) ? objectKey(tabs.at(-1)!) : null) : state.active,
    secondary: state.secondary === key ? null : state.secondary };
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
// Each envelope binds the payload to its exact project/task key. Failures never
// discard the caller's in-memory data or silently overwrite server content.
export function readStored<T>(storage: StorageLike, key: string, fallback: T, valid: (value: unknown) => value is T, warn: (message: string) => void = () => {}): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const envelope = JSON.parse(raw);
    if (envelope.schema !== 1 || envelope.owner !== key || !valid(envelope.value)) throw new Error("invalid saved state");
    return envelope.value;
  } catch { warn("本地工作现场不可用，已安全恢复默认状态；服务端内容未改动。"); return fallback; }
}
export function writeStored<T>(storage: StorageLike, key: string, value: T, warn: (message: string) => void = () => {}): boolean {
  try { storage.setItem(key, JSON.stringify({ schema: 1, owner: key, value })); return true; }
  catch { warn("无法保存本地草稿，请保持页面打开并手动保存；当前内存中的内容仍保留。"); return false; }
}
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* small preferences are optional */ }
}
