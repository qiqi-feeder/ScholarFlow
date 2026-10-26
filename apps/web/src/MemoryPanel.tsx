import { useEffect, useState } from "react";
import type { MemoryRecord, RecallSnapshot } from "@scholarflow/research";
import { api, post, put, type StreamEvent } from "./api";
import { useStoredState, sameShape } from "./use-workspace";

export function MemoryPanel({ projectId, taskId, events }: { projectId: string; taskId: string; events: StreamEvent[] }) {
  const base = `/api/projects/${projectId}/tasks/${taskId}`;
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [snapshots, setSnapshots] = useState<RecallSnapshot[]>([]);
  const [recalled, setRecalled] = useState<Array<{ id: string; revision: number; value: string; status: string }>>([]);
  const [history, setHistory] = useState<Record<string, MemoryRecord[]>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const initial = { query: "", asOf: "", knownAt: "", subject: "", predicate: "", source: "", scope: "project", correction: "", reason: "" };
  const [form, setForm] = useStoredState(`scholarflow.memory.form.v1.${projectId}.${taskId}`, initial, sameShape(initial));
  const set = (key: keyof typeof initial, value: string) => setForm(s => ({ ...s, [key]: value }));
  const revision = events.filter(e => ["memory_changed", "memory_recalled"].includes(e.type)).at(-1)?.seq;
  const refresh = async () => {
    const [m, r] = await Promise.all([api<{ memories: MemoryRecord[] }>(`${base}/memories`), api<{ snapshots: RecallSnapshot[] }>(`${base}/memory-recalls`)]);
    setMemories(m.memories); setSnapshots(r.snapshots);
  };
  useEffect(() => { let active = true; void (async () => {
    try {
      const [m, r] = await Promise.all([api<{ memories: MemoryRecord[] }>(`${base}/memories`), api<{ snapshots: RecallSnapshot[] }>(`${base}/memory-recalls`)]);
      if (active) { setMemories(m.memories); setSnapshots(r.snapshots); }
    } catch (e) { if (active) setError((e as Error).message); }
  })(); return () => { active = false; }; }, [base, revision]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); await refresh(); setNotice("已保存，可查看来源和历史版本。"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const revise = (m: MemoryRecord, action: "confirm" | "correct" | "withdraw") => act(() => put(`${base}/memories/${m.id}`, { expectedRevision: m.revision, action, value: action === "correct" ? form.correction : undefined, reason: form.reason }));
  const sources = events.filter(e => ["user_message", "assistant_message", "plan_confirmed", "material_imported", "tool_end"].includes(e.type));
  return <details className="card research-controls" aria-label="研究记忆"><summary>研究记忆 · {memories.length} 条 · 候选与争议</summary>
    <p className="muted">项目记忆可供同项目其他任务读取；任务记忆仅本任务可读。更正会保留原来源及历史版本。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="form-grid"><label>记忆查询<input aria-label="记忆查询" value={form.query} onChange={e => set("query", e.target.value)} /></label><label>事实有效时间<input aria-label="事实有效时间" placeholder="ISO 时间；留空为当前" value={form.asOf} onChange={e => set("asOf", e.target.value)} /></label><label>当时已知时间<input aria-label="当时已知时间" placeholder="ISO 时间；留空为现在" value={form.knownAt} onChange={e => set("knownAt", e.target.value)} /></label></div>
    <button disabled={busy} onClick={() => void act(async () => { const r = await post<{ memories: typeof recalled }>(`${base}/memories/recall`, { query: form.query, asOf: form.asOf || undefined, knownAt: form.knownAt || undefined }); setRecalled(r.memories); })}>查询记忆依据</button>
    {recalled.length > 0 && <section aria-label="查询记忆结果">{recalled.map(m => <p key={m.id}>{m.id} · v{m.revision} · {m.status} · {m.value}</p>)}</section>}
    <details><summary>从已保存来源建立候选</summary><label>来源事件<select aria-label="记忆来源事件" value={form.source} onChange={e => set("source", e.target.value)}><option value="">选择来源</option>{sources.map(e => <option key={e.seq} value={e.seq}>{e.seq} · {e.type} · {e.createdAt}</option>)}</select></label><label>记忆对象<input aria-label="记忆对象" value={form.subject} onChange={e => set("subject", e.target.value)} /></label><label>记忆属性<input aria-label="记忆属性" value={form.predicate} onChange={e => set("predicate", e.target.value)} /></label><label>记忆范围<select aria-label="记忆范围" value={form.scope} onChange={e => set("scope", e.target.value)}><option value="project">本项目</option><option value="task">仅本任务</option></select></label><button disabled={busy || !form.source || !form.subject || !form.predicate} onClick={() => void act(() => post(`${base}/memories`, { sourceEventSeq: Number(form.source), scope: form.scope, subject: form.subject, predicate: form.predicate }))}>保存来源记忆</button></details>
    <label>更正内容<textarea aria-label="记忆更正内容" value={form.correction} onChange={e => set("correction", e.target.value)} /></label><label>确认或更正理由<input aria-label="记忆更正理由" value={form.reason} onChange={e => set("reason", e.target.value)} /></label>
    <div aria-label="记忆列表">{memories.map(m => <article key={m.id} className="notice" data-memory-id={m.id}><strong>{m.subject} · {m.predicate}</strong><p>v{m.revision} · {m.scope === "project" ? "本项目" : "仅本任务"} · {m.status} · {m.authority.role}</p><pre>{JSON.stringify(m.value, null, 2)}</pre><p>条件：{JSON.stringify(m.conditions)} · 有效时间：{m.validFrom ?? "未知"} 至 {m.validTo ?? "未知"}</p>{m.conflictsWith.length > 0 && <p role="status">存在争议：{m.conflictsWith.join(", ")}</p>}<details><summary>查看记忆来源</summary>{m.sourceRefs.map((r, i) => <p key={i}>{r.role} · 任务 {r.taskId} · {r.kind}/{r.id} · 版本 {r.version}</p>)}</details><div className="row">{m.status === "candidate" && <button disabled={busy || !form.reason} onClick={() => void revise(m, "confirm")}>确认候选</button>}{!["tool_observation", "paper_claim"].includes(m.kind) && m.status !== "withdrawn" && <button disabled={busy || !form.correction || !form.reason} onClick={() => void revise(m, "correct")}>更正记忆</button>}{m.status !== "withdrawn" && <button disabled={busy || !form.reason} onClick={() => void revise(m, "withdraw")}>撤回记忆</button>}<button onClick={() => void api<{ versions: MemoryRecord[] }>(`${base}/memories/${m.id}/history`).then(r => setHistory(s => ({ ...s, [m.id]: r.versions }))).catch(e => setError(e.message))}>查看历史</button></div>{history[m.id] && <pre aria-label={`记忆历史 ${m.id}`}>{JSON.stringify(history[m.id], null, 2)}</pre>}</article>)}</div>
    <details open><summary>本轮记忆依据与最近召回</summary>{snapshots.map(s => <div key={s.id}><p>{s.id} · 查询 {s.query || "任务上下文"} · 估算 {s.budgetEstimate} tokens</p><p>{s.selectedMemoryVersions.map(v => `${v.id}@v${v.revision}`).join(", ") || "没有选中已核验记忆"}</p>{s.exclusions.length > 0 && <details><summary>未采用原因</summary><pre>{s.exclusions.join("\n")}</pre></details>}</div>)}</details>
  </details>;
}
