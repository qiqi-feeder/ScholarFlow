import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "./Icon";
import { PdfPreview } from "./PdfPreview";
import { closeObject, emptyWorkspace, objectKey, openObject, readPreference, selectView, validWorkspace, writePreference, type WorkObject, type WorkView } from "./workspace";
import { isString, sameShape, useStoredState } from "./use-workspace";
import {
  api,
  post,
  put,
  streamTask,
  ApiError,
  type Approval,
  type ManuscriptVersion,
  type Material,
  type ModelCatalog,
  type ModelOption,
  type Plan,
  type Project,
  type ResultVersion,
  type RunSummary,
  type Settings,
  type StreamEvent,
  type Task,
  type TaskModel,
  type MessageReference,
  type ResolvedReference,
} from "./api";

type Tab = WorkView;
type TaskDetail = {
  task: Task;
  model: TaskModel;
  sessionFile: string | null;
  events: StreamEvent[];
  plans: Plan[];
  admissions: any[];
  approvals: Approval[];
  reviewText?: string | null;
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "work", label: "任务" },
  { id: "materials", label: "材料" },
  { id: "plan", label: "方案与准入" },
  { id: "experiments", label: "实验" },
  { id: "results", label: "结果" },
  { id: "manuscript", label: "稿件" },
  { id: "review", label: "审稿" },
  { id: "settings", label: "设置" },
];

function ago(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusText(status: string): string {
  const map: Record<string, string> = {
    idle: "空闲",
    running: "运行中",
    awaiting_approval: "待确认",
    complete: "已完成",
    error: "错误",
    queued: "排队",
    succeeded: "成功",
    failed: "失败",
    cancelled: "已取消",
    unknown: "状态未知",
    unverified: "未核验",
    verified: "已核验",
    partial: "部分",
    draft: "草稿",
    confirmed: "已确认",
    rejected: "已拒绝",
    pending: "待批准",
    approved: "已批准",
    sufficient: "材料充分",
    insufficient: "材料不足",
  };
  return map[status] ?? status;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{statusText(status)}</span>;
}

function ErrorBanner({ error, clear }: { error: string | null; clear: () => void }) {
  if (!error) return null;
  return (
    <div className="banner error" role="alert">
      <span>{error}</span>
      <button className="link" onClick={clear}>关闭</button>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function NewProject({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <div className="new-project">
      {open ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void onCreate(name.trim()).then(() => {
              setName("");
              setOpen(false);
            });
          }}
        >
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="项目名称" aria-label="项目名称" />
          <button type="submit">创建</button>
          <button type="button" className="secondary" onClick={() => setOpen(false)}>取消</button>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setOpen(true)}>＋ 新建项目</button>
      )}
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(() => readPreference("scholarflow.project"));
  const [overview, setOverview] = useState<any>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [liveText, setLiveText] = useState("");
  const [streamState, setStreamState] = useState<"idle" | "connected" | "reconnecting">("idle");
  const owner = `${projectId ?? "none"}.${taskId ?? "none"}`;
  const [workspace, setWorkspace] = useStoredState(`scholarflow.workspace.state.v1.${owner}`, emptyWorkspace(), validWorkspace);
  const tab = workspace.view;
  const setTab = (view: Tab) => setWorkspace((s) => selectView(s, view));
  const [navCollapsed, setNavCollapsed] = useStoredState("scholarflow.workspace.prefs.v1.nav", false, (v): v is boolean => typeof v === "boolean");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatWidth, setChatWidth] = useStoredState("scholarflow.workspace.prefs.v1.width", 360, (v): v is number => typeof v === "number" && v >= 300 && v <= 600);
  const [library, setLibrary] = useStoredState(`scholarflow.workspace.library.v1.${owner}`, { query: "", scope: "task", status: "all" }, (v): v is { query: string; scope: string; status: string } => !!v && typeof v === "object" && typeof (v as any).query === "string" && ["task", "project"].includes((v as any).scope) && ["all", "readable", "unreadable"].includes((v as any).status));
  const { query: libraryQuery, scope: libraryScope, status: libraryStatus } = library;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [taskMenu, setTaskMenu] = useState(false);
  const resizingChat = useRef<{ x: number; width: number } | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const drawerTrigger = useRef<HTMLButtonElement | null>(null);
  const drawerReturnFocus = useRef<HTMLElement | null>(null);
  const [dirtyFiles, setDirtyFiles] = useState<string[]>([]);
  const [closeRequest, setCloseRequest] = useState<WorkObject | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [results, setResults] = useState<ResultVersion[]>([]);
  const [manuscript, setManuscript] = useState<{ files: any[]; versions: ManuscriptVersion[]; latestBuild: ManuscriptVersion | null; sourceHash: string } | null>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [taskDraft, setTaskDraft] = useState({ title: "", objective: "", reviewText: "" });
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [drafts, setDrafts] = useStoredState<Record<string, string>>("scholarflow.workspace.drafts.v1", {}, (v): v is Record<string, string> => !!v && typeof v === "object" && Object.values(v).every((text) => typeof text === "string"));
  const [mobileChat, setMobileChat] = useState(false);
  const draftKey = `${projectId}/${taskId}`;
  const [references, setReferences] = useStoredState<ResolvedReference[]>(`scholarflow.workspace.references.v1.${owner}`, [], (v): v is ResolvedReference[] => Array.isArray(v) && v.length <= 8 && v.every((r) => r && r.projectId === projectId && typeof r.id === "string" && typeof r.version === "string" && typeof r.text === "string"));
  const message = drafts[draftKey] ?? "";
  const setMessage = (value: string) => setDrafts((previous) => ({ ...previous, [draftKey]: value }));
  const streamAbort = useRef<AbortController | null>(null);
  const activeTask = useRef<{ projectId: string; taskId: string } | null>(null);
  const taskLoadSeq = useRef(0);
  // Every detail read and model write shares one ordering clock. Task loads
  // additionally have an epoch so A -> B -> A cannot revive an old callback.
  const detailRevision = useRef(0);
  const loadedTaskSeq = useRef<number | null>(null);
  const projectLoadSeq = useRef(0);
  const projectIdRef = useRef<string | null>(projectId);
  const selectedProject = projects.find((project) => project.id === projectId) ?? null;

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError) setError(`${err.code}: ${err.message}`);
    else setError((err as Error).message ?? String(err));
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const response = await api<{ projects: Project[] }>("/api/projects");
      setProjects(response.projects);
      const stored = readPreference("scholarflow.project");
      if (stored && response.projects.some((project) => project.id === stored)) setProjectId(stored);
      else if (!stored && response.projects[0]) setProjectId(response.projects[0].id);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const loadSettings = useCallback(async () => {
    try {
      const [nextSettings, nextHealth] = await Promise.all([
        api<Settings>("/api/settings"),
        api<any>("/api/health"),
      ]);
      setSettings(nextSettings);
      setHealth(nextHealth);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const loadModels = useCallback(async () => {
    try {
      setModelCatalog(await api<ModelCatalog>("/api/models"));
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const loadProject = useCallback(async (id: string) => {
    const seq = ++projectLoadSeq.current;
    try {
      const [projectOverview, materialsResponse, runsResponse, resultsResponse, manuscriptResponse, skillsResponse] = await Promise.all([
        api<any>(`/api/projects/${id}/overview`),
        api<{ materials: Material[] }>(`/api/projects/${id}/materials`),
        api<{ runs: RunSummary[] }>(`/api/projects/${id}/runs`),
        api<{ results: ResultVersion[] }>(`/api/projects/${id}/results`),
        api<any>(`/api/projects/${id}/manuscript`),
        api<{ skills: any[] }>(`/api/projects/${id}/skills`),
      ]);
      if (seq !== projectLoadSeq.current || projectIdRef.current !== id) return;
      setOverview(projectOverview);
      setTasks(projectOverview.tasks);
      setMaterials(materialsResponse.materials);
      setRuns(runsResponse.runs);
      setResults(resultsResponse.results);
      setManuscript(manuscriptResponse);
      setSkills(skillsResponse.skills);
    } catch (err) {
      if (seq === projectLoadSeq.current && projectIdRef.current === id) fail(err);
    }
  }, [fail]);

  const loadTask = useCallback(async (project: string, task: string) => {
    const seq = ++taskLoadSeq.current;
    const revision = ++detailRevision.current;
    loadedTaskSeq.current = null;
    activeTask.current = { projectId: project, taskId: task };
    setTaskId(task);
    setTaskLoading(true);
    setDetail(null);
    setEvents([]);
    setLiveText("");
    setStreamState("reconnecting");
    streamAbort.current?.abort();
    const current = () => seq === taskLoadSeq.current && activeTask.current?.projectId === project && activeTask.current.taskId === task;
    try {
      const response = await api<TaskDetail>(`/api/projects/${project}/tasks/${task}`);
      if (!current() || revision !== detailRevision.current) return;
      loadedTaskSeq.current = seq;
      setTaskLoading(false);
      setDetail(response);
      setEvents(response.events);
      setLiveText("");
      writePreference(`scholarflow.task.${project}`, task);
      const after = response.events.reduce((max, event) => Math.max(max, event.seq), 0);
      const controller = new AbortController();
      streamAbort.current = controller;
      void streamTask(
        `/api/projects/${project}/tasks/${task}/events/stream`,
        after,
        (event) => {
          if (!current()) return;
          if (event.type === "assistant_delta") {
            setLiveText((previous) => previous + (event.data.text ?? ""));
            return;
          }
          if (event.type === "assistant_message") setLiveText("");
          if (event.seq > 0) {
            setEvents((previous) => (previous.some((item) => item.seq === event.seq) ? previous : [...previous, event]));
          }
          if (event.type === "agent_status" && event.data.status) {
            detailRevision.current += 1;
            setDetail((previous) => previous && previous.task.id === task
              ? { ...previous, task: { ...previous.task, status: String(event.data.status) } }
              : previous);
          }
          if (event.type === "model_changed") {
            detailRevision.current += 1;
            const provider = String(event.data.provider ?? "");
            const id = String(event.data.id ?? "");
            if (provider && id) {
              setDetail((previous) => previous && previous.task.id === task
                ? {
                    ...previous,
                    task: { ...previous.task, modelProvider: provider, modelId: id },
                    model: { provider, id, name: String(event.data.name ?? id), inherited: false },
                  }
                : previous);
            }
          }
          if (["plan_drafted", "run_proposed", "run_queued", "result_created", "manuscript_built", "material_imported", "admission_assessed", "task_created", "model_changed", "assistant_message"].includes(event.type)) {
            void loadProject(project);
            const refreshRevision = ++detailRevision.current;
            void api<TaskDetail>(`/api/projects/${project}/tasks/${task}`).then((fresh) => {
              if (current() && refreshRevision === detailRevision.current) setDetail(fresh);
            }).catch(() => undefined);
          }
        },
        controller.signal,
        (state) => {
          if (current()) setStreamState(state === "closed" ? "idle" : state);
        },
      );
    } catch (err) {
      if (current()) {
        setTaskLoading(false);
        setStreamState("idle");
        fail(err);
      }
    }
  }, [fail, loadProject]);

  useEffect(() => {
    const warn = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener("workspace-warning", warn);
    return () => window.removeEventListener("workspace-warning", warn);
  }, []);

  useEffect(() => {
    void loadProjects();
    void loadSettings();
    void loadModels();
  }, [loadProjects, loadSettings, loadModels]);

  useEffect(() => {
    projectIdRef.current = projectId;
    setTasks([]);
    setOverview(null);
    loadedTaskSeq.current = null;
    detailRevision.current += 1;
    if (!projectId) {
      activeTask.current = null;
      taskLoadSeq.current += 1;
      streamAbort.current?.abort();
      setTaskId(null);
      setTaskLoading(false);
      setDetail(null);
      setEvents([]);
      setLiveText("");
      setStreamState("idle");
      return;
    }
    writePreference("scholarflow.project", projectId);
    activeTask.current = null;
    taskLoadSeq.current += 1;
    streamAbort.current?.abort();
    setTaskId(null);
    setTaskLoading(false);
    setDetail(null);
    setEvents([]);
    setLiveText("");
    void loadProject(projectId);
    const storedTask = readPreference(`scholarflow.task.${projectId}`);
    if (storedTask) void loadTask(projectId, storedTask);
  }, [projectId, loadProject, loadTask]);

  useEffect(() => () => streamAbort.current?.abort(), []);

  useEffect(() => {
    if (!projectId || !["work", "experiments", "results"].includes(tab)) return;
    const timer = setInterval(() => {
      void loadProject(projectId);
    }, 2500);
    return () => clearInterval(timer);
  }, [projectId, tab, loadProject]);

  const createProject = async (name: string) => {
    try {
      const response = await post<{ project: Project }>("/api/projects", { name });
      await loadProjects();
      setProjectId(response.project.id);
      setTab("work");
    } catch (err) {
      fail(err);
    }
  };

  const createTask = async () => {
    if (!projectId || !taskDraft.title.trim() || !taskDraft.objective.trim()) return;
    setBusy(true);
    try {
      const response = await post<{ task: Task }>(`/api/projects/${projectId}/tasks`, taskDraft);
      setTaskDraft({ title: "", objective: "", reviewText: "" });
      setShowTaskForm(false);
      await loadProject(projectId);
      await loadTask(projectId, response.task.id);
      setTab("work");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const selectTask = (id: string) => {
    if (!projectId) return;
    void loadTask(projectId, id);
    setTaskMenu(false);
    setDrawerOpen(false);
  };

  const currentApprovals = detail?.approvals ?? [];
  const pendingApprovals = currentApprovals.filter((approval) => approval.status === "pending");
  const confirmedPlan = detail?.plans.find((plan) => plan.status === "confirmed") ?? null;
  const currentManuscriptBuild = manuscript?.latestBuild ?? null;
  const effectiveModel = useMemo<TaskModel | null>(() => {
    if (!detail) return null;
    if (detail.model) return detail.model;
    const provider = detail.task.modelProvider ?? modelCatalog?.default.provider ?? settings?.model.provider;
    const id = detail.task.modelId ?? modelCatalog?.default.id ?? settings?.model.id;
    if (!provider || !id) return null;
    return { provider, id, name: id, inherited: !detail.task.modelProvider || !detail.task.modelId };
  }, [detail, modelCatalog, settings]);
  const effectiveModelKey = effectiveModel ? `${effectiveModel.provider}:${effectiveModel.id}` : "";
  const modelAvailable = !effectiveModel
    ? false
    : !modelCatalog
      ? true
      : modelCatalog.models.length === 0
        ? effectiveModel.inherited
        : modelCatalog.models.some((model) => `${model.provider}:${model.id}` === effectiveModelKey);
  const agentAnswering = detail?.task.status === "running";
  const taskReady = () => loadedTaskSeq.current === taskLoadSeq.current
    && activeTask.current?.projectId === projectId && activeTask.current?.taskId === taskId
    && detail?.task.id === taskId;

  const sendMessage = async () => {
    if (!taskReady() || !projectId || !taskId || !message.trim() || busy || switchingModel || agentAnswering) return;
    if (!modelAvailable) {
      setError("当前任务模型不可用。请在会话顶部选择宿主实际可用的模型后再发送；不会静默回退。");
      return;
    }
    const target = { projectId, taskId };
    setBusy(true);
    const text = message;
    const sentReferences = references;
    setMessage("");
    setReferences([]);
    try {
      await post(`/api/projects/${projectId}/tasks/${taskId}/messages`, {
        text,
        clientId: `msg_${crypto.randomUUID()}`,
        references: sentReferences,
      });
    } catch (err) {
      fail(err);
      setDrafts((previous) => ({ ...previous, [`${target.projectId}/${target.taskId}`]: previous[`${target.projectId}/${target.taskId}`] || text }));
      // Keep failed attachments on their original task, even if the user switched.
      setReferences(sentReferences);
    } finally {
      setBusy(false);
    }
  };

  const switchTaskModel = async (provider: string, id: string) => {
    if (!taskReady() || !projectId || !taskId || busy || switchingModel) return;
    if (agentAnswering) {
      setError("回答仍在进行。请先等待完成或停止回答，再切换模型；已生成的历史不会被改写。");
      return;
    }
    const target = { projectId, taskId };
    const epoch = taskLoadSeq.current;
    const revision = ++detailRevision.current;
    setSwitchingModel(true);
    try {
      const response = await put<{ task: Task; model: TaskModel }>(
        `/api/projects/${projectId}/tasks/${taskId}/model`,
        { provider, modelId: id },
      );
      if (epoch !== taskLoadSeq.current || activeTask.current?.projectId !== target.projectId
        || activeTask.current?.taskId !== target.taskId || revision !== detailRevision.current) return;
      setDetail((previous) => previous ? { ...previous, task: response.task, model: response.model } : previous);
      setTasks((previous) => previous.map((task) => task.id === response.task.id ? response.task : task));
    } catch (err) {
      if (epoch === taskLoadSeq.current) fail(err);
    } finally {
      setSwitchingModel(false);
    }
  };

  const stopAnswer = async () => {
    if (!taskReady() || !projectId || !taskId) return;
    try {
      await post(`/api/projects/${projectId}/tasks/${taskId}/stop`);
    } catch (err) {
      fail(err);
    }
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const panel = sidebarRef.current;
    const close = panel?.querySelector<HTMLButtonElement>(".drawer-close");
    close?.focus();
    const protectFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDrawerOpen(false); (drawerReturnFocus.current ?? drawerTrigger.current)?.focus(); }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), select, input, textarea, summary, [tabindex="0"]')].filter((node) => node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", protectFocus);
    return () => window.removeEventListener("keydown", protectFocus);
  }, [drawerOpen]);

  const resizeChat = (width: number) => setChatWidth(Math.max(300, Math.min(600, width)));
  const openDrawer = () => { drawerReturnFocus.current = document.activeElement as HTMLElement | null; setDrawerOpen(true); };

  const objects: WorkObject[] = tab === "materials" ? materials.filter((m) =>
    (!libraryQuery || m.title.toLowerCase().includes(libraryQuery.toLowerCase())) && (libraryScope !== "task" || m.taskId === taskId)
    && (libraryStatus === "all" || (libraryStatus === "readable" ? !!m.note : !m.note)))
    .map((m) => ({ kind: "material", id: m.id, title: m.title, version: m.sha256 }))
    : tab === "experiments" ? runs.map((r) => ({ kind: "run", id: r.id, title: `${r.name} · ${statusText(r.status)}` }))
    : tab === "results" ? results.map((r) => ({ kind: "result", id: r.id, title: r.title }))
    : tab === "plan" ? (detail?.plans ?? []).map((p) => ({ kind: "plan", id: p.id, title: `v${p.version} · ${p.objective}` }))
    : tab === "manuscript" ? (manuscript?.files ?? []).filter((f) => f.kind === "text").map((f) => ({ kind: "manuscript", id: f.path, title: f.path }))
    : tab === "review" ? (detail?.reviewText ?? "").split(/\n\s*\n/).filter(Boolean).map((text, i) => ({ kind: "review", id: String(i), title: text })) : [];
  const activeObject = workspace.tabs.find((o) => objectKey(o) === workspace.active);
  const secondaryObject = workspace.tabs.find((o) => objectKey(o) === workspace.secondary);
  const open = (object: WorkObject) => setWorkspace((s) => openObject(s, object));
  const selectObject = (object: WorkObject) => { open(object); setMobileChat(false); setDrawerOpen(false); };
  const attachReference = async (reference: MessageReference) => {
    if (!projectId || !taskId || !taskReady()) return;
    const target = { projectId, taskId, epoch: taskLoadSeq.current };
    try {
      const response = await post<{ references: ResolvedReference[] }>(`/api/projects/${projectId}/tasks/${taskId}/references/resolve`, { references: [reference] });
      if (target.epoch !== taskLoadSeq.current) return;
      setReferences((previous) => [...previous.filter((r) => !(r.kind === reference.kind && r.id === reference.id && r.file === reference.file && r.page === reference.page && r.start === reference.start)), ...response.references].slice(-8));
    } catch (err) { if (target.epoch === taskLoadSeq.current) fail(err); }
  };
  const referenceObject = (object: WorkObject): MessageReference | null => {
    if (object.kind === "manuscript") {
      const version = manuscript?.versions.find((v) => v.files.some((f) => f.path === object.id && f.sha256 === manuscript.files.find((e) => e.path === object.id)?.sha256));
      if (!version) { setError("请先保存稿件版本，再添加引用。"); return null; }
      return { kind: "manuscript", id: version.id, file: object.id, version: version.files.find((f) => f.path === object.id)!.sha256 };
    }
    return { kind: object.kind, id: object.kind === "review" ? `${taskId}:${object.id}` : object.id, version: object.version ?? "",
      ...(object.kind === "material" && materials.find((m) => m.id === object.id)?.mediaType === "application/pdf" ? { page: workspace.reading[object.id] ?? 1 } : {}) };
  };
  const renderMaterial = (object: WorkObject) => {
    const material = materials.find((m) => m.id === object.id);
    if (!material) return <p role="status">材料已不可用，请关闭标签或重新选择。</p>;
    return <section className="card reader"><h3>{material.title}</h3>
      {material.mediaType !== "application/pdf" && <label>阅读页码 <input aria-label={`阅读页码 ${material.title}`} type="number" min={1} value={workspace.reading[material.id] ?? 1} onChange={(e) => setWorkspace((s) => ({ ...s, reading: { ...s.reading, [material.id]: Math.max(1, Number(e.target.value)) } }))} /></label>}
      {material.mediaType === "application/pdf"
        ? <PdfPreview title={`原文 ${material.title}`} url={`/api/projects/${projectId}/materials/${material.id}/file`} page={workspace.reading[material.id] ?? 1} onPage={(page) => setWorkspace((s) => ({ ...s, reading: { ...s.reading, [material.id]: page } }))} />
        : <iframe title={`原文 ${material.title}`} sandbox="allow-same-origin" src={`/api/projects/${projectId}/materials/${material.id}/file`} />}
      <details><summary>笔记与来源</summary>{material.note ? <ReferenceText text={material.note} onReference={(selection) => void attachReference({ kind: "material", id: material.id, version: material.sha256, ...selection })} /> : <p>暂无可读文本；可查看原始文件或导入可读版本。</p>}<p>{material.source.url} · 许可：{material.source.license ?? "未知"}</p></details>
    </section>;
  };

  return (
    <div className={`app-shell ${mobileChat ? "show-chat" : ""} ${navCollapsed ? "nav-collapsed" : ""} ${chatCollapsed ? "chat-collapsed" : ""} ${drawerOpen ? "drawer-open" : ""}`} style={{ "--chat-width": `${chatWidth}px` } as React.CSSProperties}>
      <header className="global-bar">
        <div className="app-brand"><Icon name="logo" size={17} /><h1>ScholarFlow</h1><span className="local-label">LOCAL</span></div>
        <div className="global-context"><h2>{selectedProject?.name ?? "选择或创建项目"}</h2><span className="context-divider">/</span><span className="current-task">{detail?.task.title ?? (taskLoading ? "任务加载中" : "选择任务")}</span>{detail && <StatusBadge status={detail.task.status} />}</div>
        <div className="global-actions"><span className="connection-status"><span className={`dot ${streamState === "connected" ? "ok" : streamState === "reconnecting" ? "warn" : ""}`} />{streamState === "connected" ? "事件流已连接" : streamState === "reconnecting" ? "事件流重连中" : "事件流未连接"}</span><button className="icon-button" aria-label="刷新" title="刷新项目" onClick={() => projectId && void loadProject(projectId)} disabled={!projectId}><Icon name="refresh" size={16} /></button><button className="icon-button" aria-label="设置与能力状态" title={`Agent ${health?.agent?.configured ? "已配置" : "未配置"} · TeX ${health?.latex?.pdflatex?.available ? "可用" : "不可用"}`} onClick={() => setTab("settings")}><Icon name="settings" size={16} /></button><button className="icon-button chat-toggle" aria-label={chatCollapsed ? "展开会话" : "收起会话"} title={chatCollapsed ? "展开会话" : "收起会话"} onClick={() => setChatCollapsed((v) => !v)}><Icon name="chat" size={17} /></button></div>
        {navCollapsed && <div className="compact-context"><select aria-label="紧凑项目" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="紧凑任务" value={taskId ?? ""} onChange={(e) => selectTask(e.target.value)}><option value="">选择任务</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></div>}
      </header>
      <nav className="mobile-session-nav" aria-label="工作区与会话">
        <button className="icon-button" ref={drawerTrigger} aria-label="打开导航" aria-expanded={drawerOpen} onClick={openDrawer}><Icon name="panel" /></button>
        <button aria-pressed={!mobileChat} onClick={() => setMobileChat(false)}>工作区</button>
        <button aria-pressed={mobileChat} onClick={() => setMobileChat(true)}>会话</button>
      </nav>
      <aside className="rail" aria-label="工作视图" role="tablist" aria-orientation="vertical" inert={drawerOpen}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`rail-button ${tab === item.id ? "active" : ""}`}
            aria-label={item.label}
            title={item.label}
            aria-pressed={tab === item.id}
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.id} size={20} />
            {item.id === "experiments" && pendingApprovals.length > 0 && <span className="rail-count">{pendingApprovals.length}</span>}
          </button>
        ))}
        <div className="rail-foot">
          <button className="rail-button nav-toggle" aria-label={navCollapsed ? "展开导航" : "收起导航"} onClick={() => setNavCollapsed((v) => !v)}><Icon name="panel" /></button>
          <button className="rail-button tablet-nav-toggle" aria-label="打开内容导航" onClick={openDrawer}><Icon name="panel" /></button>
        </div>
      </aside>

      {drawerOpen && <button className="drawer-backdrop" aria-label="关闭导航遮罩" onClick={() => { setDrawerOpen(false); (drawerReturnFocus.current ?? drawerTrigger.current)?.focus(); }} />}
      <aside className="nav-panel" ref={sidebarRef} data-view={tab} role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen ? true : undefined} aria-label={drawerOpen ? "导航菜单" : "内容导航"}>
        <div className="drawer-heading"><strong>工作导航</strong><button className="icon-button drawer-close" aria-label="关闭导航" onClick={() => { setDrawerOpen(false); (drawerReturnFocus.current ?? drawerTrigger.current)?.focus(); }}><Icon name="close" /></button></div>
        <label className="drawer-view-picker">工作视图<select aria-label="工作视图" value={tab} onChange={(e) => { setTab(e.target.value as Tab); setDrawerOpen(false); }}>{TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <details className="project-switcher" open={projectMenu}>
          <summary onClick={(e) => { e.preventDefault(); setProjectMenu((v) => !v); }}><Icon name="logo" size={17} /><span><small>当前项目</small><strong>{selectedProject?.name ?? "选择或创建项目"}</strong></span><Icon name="chevron" size={13} /></summary>
        <div className="switcher-menu"><div className="project-list" aria-label="项目列表">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-item ${project.id === projectId ? "active" : ""}`}
              onClick={() => { setProjectId(project.id); setProjectMenu(false); setDrawerOpen(false); }}
            >
              <span className="project-name">{project.name}</span>
              <span className="project-meta">{project.id.slice(0, 10)}</span>
            </button>
          ))}
        </div>
        <NewProject onCreate={createProject} />
        </div></details>
        <details className="task-switcher" open={taskMenu || !taskId}>
          <summary onClick={(e) => { e.preventDefault(); setTaskMenu((v) => !v); }}><span className={`dot ${detail?.task.status === "running" ? "ok" : ""}`} /><span><small>当前任务</small><strong>{tasks.find((t) => t.id === taskId)?.title ?? "选择一个任务"}</strong></span><Icon name="chevron" size={13} /></summary>
        <div className="switcher-menu">
        <div className="nav-section-head">
          <h2>任务</h2>
          <button className="secondary small" onClick={() => setShowTaskForm(!showTaskForm)}>
            {showTaskForm ? "收起" : "＋ 新建任务"}
          </button>
        </div>
        {showTaskForm && (
          <form
            className="stack card task-create"
            onSubmit={(event) => {
              event.preventDefault();
              void createTask();
            }}
          >
            <input
              placeholder="任务标题，例如：复现基线并检验学习率修改"
              value={taskDraft.title}
              onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
              aria-label="任务标题"
            />
            <textarea
              placeholder="目标：明确的科研问题、约束和交付物"
              rows={4}
              value={taskDraft.objective}
              onChange={(event) => setTaskDraft({ ...taskDraft, objective: event.target.value })}
              aria-label="任务目标"
            />
            <textarea
              placeholder="可选：导入审稿意见。它作为数据进入本任务，不会自动改变项目规则。"
              rows={3}
              value={taskDraft.reviewText}
              onChange={(event) => setTaskDraft({ ...taskDraft, reviewText: event.target.value })}
              aria-label="审稿意见"
            />
            <button type="submit" disabled={busy}>创建任务</button>
          </form>
        )}
        <div className="task-list" aria-label="任务列表">
          {tasks.length === 0 && <p className="muted">还没有任务。建立独立目标时才创建新任务；切换面板不会创建会话。</p>}
          {tasks.map((task) => (
            <button
              key={task.id}
              className={`task-item ${task.id === taskId ? "active" : ""}`}
              onClick={() => selectTask(task.id)}
            >
              <span className="task-title">{task.title}</span>
              <span className="task-meta"><StatusBadge status={task.status} /> {ago(task.updatedAt)}</span>
            </button>
          ))}
        </div>
        </div></details>
        <div className="object-library">
          <h3><Icon name={tab} size={16} />{tab === "materials" ? "论文库" : tab === "manuscript" ? "稿件目录" : `${TABS.find((t) => t.id === tab)?.label}内容`}<span className="library-count">{objects.length}</span></h3>
          {tab === "materials" && <><div className="library-scope"><button aria-pressed={libraryScope === "task"} onClick={() => setLibrary((s) => ({ ...s, scope: "task" }))}>当前任务</button><button aria-pressed={libraryScope === "project"} onClick={() => setLibrary((s) => ({ ...s, scope: "project" }))}>本项目全部</button></div><input aria-label="筛选论文" placeholder="搜索标题…" value={libraryQuery} onChange={(e) => setLibrary((s) => ({ ...s, query: e.target.value }))} /><select aria-label="材料状态" value={libraryStatus} onChange={(e) => setLibrary((s) => ({ ...s, status: e.target.value }))}><option value="all">全部状态</option><option value="readable">有提取文本/摘要</option><option value="unreadable">待补可读文本</option></select></>}
          {objects.length === 0 && <p className="muted">没有匹配内容；可在工作区创建或导入。</p>}
          {objects.map((object) => <button key={objectKey(object)} className="object-item" aria-label={object.title} aria-pressed={workspace.active === objectKey(object)} onClick={() => selectObject(object)}><span className="object-title"><Icon name={object.kind === "material" ? "materials" : object.kind === "run" ? "experiments" : object.kind === "result" ? "results" : object.kind} size={15} />{object.title}</span>{object.kind === "material" && <span className="object-meta">{materials.find((m) => m.id === object.id)?.source.channel} · {materials.find((m) => m.id === object.id)?.note ? "有摘要 / 提取文本" : "待补可读文本"}</span>}</button>)}
        </div>
        <div className="nav-footer"><span className="dot ok" />本地工作区<span>单用户</span></div>
      </aside>

      <main className="workspace" inert={drawerOpen}>
        <ErrorBanner error={error} clear={() => setError(null)} />
        {settings && !settings.model.configured && modelCatalog?.models.length === 0 && (
          <div className="banner warn">
            模型尚未配置，已有材料仍可查看。前往
            <button className="link" onClick={() => setTab("settings")}>设置</button>
            配置 Key。
          </div>
        )}

        {!selectedProject ? (
          <section className="empty">
            <h3>开始一个研究项目</h3>
            <p>项目拥有独立的材料、任务、实验、结果和稿件。在左侧“新建项目”开始。</p>
          </section>
        ) : (
          <>
            <div className="workspace-toolbar"><div className="workspace-view-title"><Icon name={tab} size={17} /><h3>{tab === "materials" ? "文献阅读" : tab === "manuscript" ? "稿件工作区" : TABS.find((t) => t.id === tab)?.label}</h3></div><div className="workspace-tools"><label><Icon name="compare" size={15} /><select aria-label="工作区布局" value={workspace.layout} onChange={(e) => setWorkspace((s) => ({ ...s, layout: e.target.value as typeof s.layout }))}><option value="single">单内容</option><option value="split">双内容对照</option><option value="list-detail">列表与详情</option></select></label><button className="icon-button" aria-label="返回工作视图" title="返回工作视图" onClick={() => setWorkspace((s) => ({ ...s, active: null }))}><Icon name="work" size={16} /></button></div></div>
            {activeObject && <div className="reference-action"><button disabled={!taskReady()} onClick={() => { const reference = referenceObject(activeObject); if (reference) void attachReference(reference); }}>引用当前内容</button><span>仅加入下一条消息；打开内容不会自动发送</span></div>}
            {workspace.tabs.length > 0 && <nav className="object-tabs" aria-label="已打开内容">{workspace.tabs.map((object) => <span className={workspace.active === objectKey(object) ? "is-active" : ""} key={objectKey(object)}><button className="object-tab-title" aria-pressed={workspace.active === objectKey(object)} onClick={() => open(object)}>{object.title}</button><button className="tab-action" aria-label={`固定 ${object.title}`} title={object.pinned ? "取消固定" : "固定标签"} aria-pressed={!!object.pinned} onClick={() => setWorkspace((s) => ({ ...s, tabs: s.tabs.map((o) => objectKey(o) === objectKey(object) ? { ...o, pinned: !o.pinned } : o) }))}><Icon name="pin" size={13} /></button><button className="tab-action" aria-label={`对照 ${object.title}`} title="加入对照" onClick={() => setWorkspace((s) => ({ ...s, secondary: objectKey(object), layout: "split" }))}><Icon name="compare" size={13} /></button><button className="tab-action" aria-label={`关闭 ${object.title}`} title="关闭标签" onClick={() => { if (object.kind === "manuscript" && dirtyFiles.includes(object.id)) { open(object); setCloseRequest(object); } else setWorkspace((s) => closeObject(s, objectKey(object))); }}><Icon name="close" size={13} /></button></span>)}</nav>}
            {tab === "materials" && activeObject?.kind === "material" && <div className={`object-content ${workspace.layout === "split" ? "split" : ""}`}>{renderMaterial(activeObject)}{workspace.layout === "split" && secondaryObject?.kind === "material" && secondaryObject.id !== activeObject.id && renderMaterial(secondaryObject)}</div>}
            {tab === "review" && <section className="card review-panel">
              <div className="row space-between"><h3>所选审稿意见</h3><span className="badge">回应草稿</span></div>
              <span className="review-eyebrow">审稿原文</span><blockquote>{activeObject?.kind === "review" ? activeObject.title : "在左侧选择意见；创建任务时可填写原始审稿意见。"}</blockquote>
              <label htmlFor="review-draft">逐条回应</label><p className="muted">记录修改、依据及仍需核对的事项。内容按当前任务和意见保留。</p>
              <textarea id="review-draft" rows={9} placeholder="围绕这条意见整理回应草稿…" aria-label="审稿回应草稿" value={drafts[`${draftKey}/review/${activeObject?.id ?? "none"}`] ?? ""} onChange={(e) => setDrafts((s) => ({ ...s, [`${draftKey}/review/${activeObject?.id ?? "none"}`]: e.target.value }))} />
            </section>}
            <div className="workspace-content">
              {tab === "work" && (
                <OverviewPanel
                  overview={overview}
                  detail={detail}
                  pendingApprovals={pendingApprovals}
                  openExperiments={() => setTab("experiments")}
                />
              )}

              {projectId && (<div hidden={tab !== "materials" || activeObject?.kind === "material"}>
                <MaterialsPanel
                  projectId={projectId}
                  taskId={taskId}
                  materials={materials}
                  onChanged={() => void loadProject(projectId)}
                  fail={fail}
                />
              </div>)}

              {projectId && (<div hidden={tab !== "plan"}>
                <PlanPanel
                  projectId={projectId}
                  taskId={taskId}
                  detail={activeObject?.kind === "plan" && detail ? { ...detail, plans: detail.plans.filter((p) => p.id === activeObject.id) } : detail}
                  skills={skills}
                  onChanged={() => {
                    void loadProject(projectId);
                    if (taskId) void loadTask(projectId, taskId);
                  }}
                  fail={fail}
                />
              </div>)}

              {projectId && (<div hidden={tab !== "experiments"}>
                <ExperimentsPanel
                  projectId={projectId}
                  taskId={taskId}
                  approvals={currentApprovals}
                  runs={activeObject?.kind === "run" ? runs.filter((r) => r.id === activeObject.id) : runs}
                  settings={settings}
                  confirmedPlan={confirmedPlan}
                  onChanged={() => {
                    void loadProject(projectId);
                    if (taskId) void loadTask(projectId, taskId);
                  }}
                  fail={fail}
                />
              </div>)}

              {projectId && (<div hidden={tab !== "results"}>
                <ResultsPanel
                  projectId={projectId}
                  taskId={taskId}
                  runs={runs}
                  results={activeObject?.kind === "result" ? results.filter((r) => r.id === activeObject.id) : results}
                  onChanged={() => projectId && void loadProject(projectId)}
                  fail={fail}
                />
              </div>)}

              {projectId && (<div hidden={tab !== "manuscript"}>
                <ManuscriptPanel
                  projectId={projectId}
                  requestedFile={activeObject?.kind === "manuscript" ? activeObject.id : null}
                  closingFile={closeRequest?.id ?? null}
                  onDirtyFiles={setDirtyFiles}
                  onCloseComplete={(close) => { if (close && closeRequest) setWorkspace((s) => closeObject(s, objectKey(closeRequest))); setCloseRequest(null); }}
                  taskId={taskId}
                  data={manuscript}
                  build={currentManuscriptBuild}
                  onReference={(reference) => void attachReference(reference)}
                  onChanged={() => { setError(null); void loadProject(projectId); }}
                  fail={fail}
                />
              </div>)}

              {tab === "settings" && (
                <SettingsPanel
                  settings={settings}
                  health={health}
                  onSaved={async () => {
                    await loadSettings();
                    await loadModels();
                    if (projectId) await loadProject(projectId);
                    if (projectId && taskId) await loadTask(projectId, taskId);
                  }}
                  fail={fail}
                />
              )}
            </div>
          </>
        )}
      </main>

      <aside className="chat-panel" aria-label="任务会话" inert={drawerOpen}>
        <div className="chat-divider" role="separator" aria-label="会话宽度" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={600} aria-valuenow={chatWidth} tabIndex={0}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resizingChat.current = { x: event.clientX, width: chatWidth }; }}
          onPointerMove={(event) => { if (resizingChat.current) resizeChat(resizingChat.current.width + resizingChat.current.x - event.clientX); }}
          onPointerUp={() => { resizingChat.current = null; }} onPointerCancel={() => { resizingChat.current = null; }}
          onKeyDown={(event) => { const change = event.key === "ArrowLeft" ? chatWidth + 16 : event.key === "ArrowRight" ? chatWidth - 16 : event.key === "Home" ? 300 : event.key === "End" ? 600 : null; if (change !== null) { event.preventDefault(); resizeChat(change); } }} />
        <div className="mobile-chat-notice"><ErrorBanner error={error} clear={() => setError(null)} /></div>
        {!detail && taskId && (
          <div role="status">
            {taskLoading ? "正在加载所选任务…" : "任务加载失败，请重试或选择其他任务。"}
            {!taskLoading && <button onClick={() => projectId && void loadTask(projectId, taskId)}>重试加载任务</button>}
          </div>
        )}
        <ChatPanel
          detail={detail}
          events={events}
          liveText={liveText}
          busy={busy}
          answering={agentAnswering}
          message={message}
          setMessage={setMessage}
          sendMessage={sendMessage}
          stopAnswer={stopAnswer}
          pendingApprovals={pendingApprovals}
          openExperiments={() => setTab("experiments")}
          models={modelCatalog?.models ?? []}
          effectiveModel={effectiveModel}
          modelAvailable={modelAvailable}
          switchingModel={switchingModel}
          onSwitchModel={(provider, id) => void switchTaskModel(provider, id)}
          references={references}
          removeReference={(index) => setReferences((items) => items.filter((_, i) => i !== index))}
        />
      </aside>
    </div>
  );
}

function OverviewPanel(props: {
  overview: any;
  detail: TaskDetail | null;
  pendingApprovals: Approval[];
  openExperiments: () => void;
}) {
  if (!props.detail) {
    return (
      <section className="empty small">
        <h3>任务概览</h3>
        <p>从左侧任务列表选择一个任务。中央视图与右侧会话始终指向同一个当前任务。</p>
      </section>
    );
  }
  const counts = props.overview?.counts ?? {};
  const latestRuns: any[] = props.overview?.latestRuns ?? [];
  const countCards: Array<{ label: string; value: number }> = [
    { label: "任务", value: Number(counts.tasks ?? 0) },
    { label: "材料", value: Number(counts.materials ?? 0) },
    { label: "运行", value: Number(counts.runs ?? 0) },
    { label: "结果", value: Number(counts.results ?? 0) },
    { label: "Skills", value: Number(counts.skills ?? 0) },
  ];
  return (
    <section className="overview-panel">
      <div className="section-head">
        <div>
          <h2>任务概览</h2>
          <p className="muted">{props.detail.task.objective}</p>
        </div>
        <StatusBadge status={props.detail.task.status} />
      </div>

      <div className="stat-grid">
        {countCards.map((card) => (
          <div className="stat-card" key={card.label}>
            <span className="stat-value">{card.value}</span>
            <span className="stat-label">{card.label}</span>
          </div>
        ))}
      </div>

      {props.pendingApprovals.length > 0 && (
        <button className="banner warn button-banner" onClick={props.openExperiments}>
          {props.pendingApprovals.length} 个实验提案等待你批准精确指纹。Agent 不会自行启动。前往实验面板 →
        </button>
      )}

      <div className="overview-section">
        <h3>最近实验</h3>
        {latestRuns.length === 0 && <p className="muted">还没有运行记录。方案确认并在实验面板批准后，运行会显示在这里。</p>}
        <div className="run-list">
          {latestRuns.map((run) => (
            <div className="run-row" key={String(run.runId ?? run.id ?? JSON.stringify(run))}>
              <code>{String(run.runId ?? run.id ?? "run")}</code>
              <StatusBadge status={String(run.status ?? "unknown")} />
              <span className="muted">{ago(run.createdAt ?? run.updatedAt)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="overview-section">
        <h3>右侧会话</h3>
        <p className="muted">
          会话按任务独立持久化。切换中央的“材料 / 方案 / 实验 / 结果 / 稿件”不会卸载会话，也不会重置当前任务的流式回答。
        </p>
      </div>
    </section>
  );
}

function ReferenceText({ text, onReference }: { text: string; onReference: (selection: { start: number; end: number; quote: string }) => void }) {
  const [selection, setSelection] = useState({ start: 0, end: 0, quote: "" });
  return <div className="reference-text"><textarea aria-label="可引用来源文本" value={text} readOnly rows={6} onSelect={(e) => { const t = e.currentTarget; setSelection({ start: t.selectionStart, end: t.selectionEnd, quote: text.slice(t.selectionStart, t.selectionEnd) }); }} /><button disabled={!selection.quote || selection.quote.length > 4000} onClick={() => onReference(selection)}>引用所选文本</button></div>;
}

function ChatPanel(props: {
  references: ResolvedReference[];
  removeReference: (index: number) => void;
  detail: TaskDetail | null;
  events: StreamEvent[];
  liveText: string;
  busy: boolean;
  answering: boolean;
  message: string;
  setMessage: (value: string) => void;
  sendMessage: () => Promise<void>;
  stopAnswer: () => Promise<void>;
  pendingApprovals: Approval[];
  openExperiments: () => void;
  models: ModelOption[];
  effectiveModel: TaskModel | null;
  modelAvailable: boolean;
  switchingModel: boolean;
  onSwitchModel: (provider: string, id: string) => void;
}) {
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const chatLog = useRef<HTMLDivElement | null>(null);
  const followAnswer = useRef(true);
  useEffect(() => { followAnswer.current = true; }, [props.detail?.task.id]);
  useEffect(() => {
    if (followAnswer.current && chatLog.current) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [props.events.length, props.liveText]);
  const eventNodes = props.events.filter((event) =>
    ["user_message", "message_context", "assistant_message", "error", "tool_start", "tool_end", "context_loaded", "plan_drafted", "plan_confirmed", "run_proposed", "run_queued", "run_verified", "result_created", "manuscript_built", "material_imported", "admission_assessed", "task_created", "context_compacted", "model_changed"].includes(event.type),
  );
  if (!props.detail) {
    return (
      <div className="chat-empty">
        <h3>选择一个任务</h3>
        <p>任务拥有独立的 Pi 会话。刷新或重启后从持久化事件恢复；不会因切换面板创建新会话。</p>
      </div>
    );
  }
  const currentKey = props.effectiveModel ? `${props.effectiveModel.provider}:${props.effectiveModel.id}` : "";
  const hasCurrentOption = props.models.some((model) => `${model.provider}:${model.id}` === currentKey);
  const canSwitchModel = !props.busy && !props.switchingModel && !props.answering && props.models.length > 0;
  const sendDisabled = props.busy || props.switchingModel || props.answering || !props.modelAvailable || !props.message.trim();
  return (
    <>
      <div className="chat-head">
        <div>
          <h3><Icon name="chat" size={16} />{props.detail.task.title}</h3>
          <p className="muted">{props.detail.task.objective}</p>
        </div>
        <StatusBadge status={props.detail.task.status} />
      </div>

      {props.pendingApprovals.length > 0 && (
        <button className="banner warn button-banner" onClick={props.openExperiments}>
          {props.pendingApprovals.length} 个实验提案等待你批准精确指纹。Agent 不会自行启动。前往实验面板 →
        </button>
      )}
      <div className="chat-log" role="log" aria-live="polite" ref={chatLog} onScroll={(event) => { const log = event.currentTarget; followAnswer.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48; }}>
        {eventNodes.length === 0 && <p className="muted">发送第一条消息，或先让 Agent 检索材料、形成方案。论文内容只会作为数据，不会成为宿主规则。</p>}
        {eventNodes.map((event) => (
          <ChatEvent key={`${event.type}-${event.seq}-${event.createdAt}`} event={event} />
        ))}
        {props.liveText && (
          <div className="message assistant">
            <Markdown text={props.liveText} />
            <span className="cursor" aria-label="正在生成" />
          </div>
        )}
        <div ref={chatEnd} />
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void props.sendMessage();
        }}
      >
        {props.references.length > 0 && <div className="reference-list" aria-label="本条消息引用">{props.references.map((r, index) => <div key={`${r.kind}-${r.id}-${index}`}><span title={r.text}>{r.title}{r.page ? ` · 第 ${r.page} 页` : ""}{r.quote ? " · 选区" : ""}</span><button type="button" aria-label={`移除引用 ${r.title}`} onClick={() => props.removeReference(index)}>×</button></div>)}</div>}
        <textarea
          rows={3}
          value={props.message}
          onChange={(event) => props.setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!sendDisabled) void props.sendMessage();
            }
          }}
          placeholder="描述目标、上传材料路径，或让 Agent 读取 Skill 并推进当前阶段。Enter 发送，Shift+Enter 换行。"
          aria-label="消息"
        />
        <div className="composer-actions">
      <div className="model-picker">
        <label htmlFor="task-model-select">当前任务模型</label>
        <select
          id="task-model-select"
          aria-label="当前任务模型"
          value={currentKey}
          disabled={!canSwitchModel}
          onChange={(event) => {
            const separator = event.target.value.indexOf(":");
            if (separator < 0) return;
            props.onSwitchModel(event.target.value.slice(0, separator), event.target.value.slice(separator + 1));
          }}
        >
          {!hasCurrentOption && props.effectiveModel && (
            <option value={currentKey}>
              {props.effectiveModel.provider}/{props.effectiveModel.name}{props.modelAvailable ? "" : "（不可用）"}
            </option>
          )}
          {!props.effectiveModel && <option value="">没有可用模型</option>}
          {props.models.map((model) => (
            <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>
              {model.provider}/{model.name}
            </option>
          ))}
        </select>
        <span className="model-hint">
          {props.switchingModel
            ? "正在保存模型选择…"
            : props.answering
              ? "回答中，完成或停止后可切换"
              : props.effectiveModel?.inherited
                ? "继承默认模型，发送后固定到本任务"
                : "仅影响本任务，从下一条消息生效"}
        </span>
        {!props.modelAvailable && <span className="model-warning">所选模型当前不可用，发送已阻止</span>}
      </div>


          <button type="button" className="secondary" onClick={() => void props.stopAnswer()} disabled={!props.answering && !props.busy}>停止回答</button>
          <button type="submit" className="send-button" aria-label="发送" title="发送消息" disabled={sendDisabled}><Icon name="send" size={17} /></button>
        </div>
      </form>
    </>
  );
}

function ChatEvent({ event }: { event: StreamEvent }) {
  if (event.type === "message_context") return <details className="message-references"><summary>本条消息引用 · {event.data.references.length} 项</summary>{event.data.references.map((r: ResolvedReference, i: number) => <div key={i}><strong>{r.title}{r.page ? ` · 第 ${r.page} 页` : ""}</strong><p className="small">来源 {r.kind}/{r.id} · 版本 {r.version.slice(0, 12)}</p><pre>{r.text}</pre></div>)}</details>;
  if (event.type === "user_message") {
    return <div className="message user"><Markdown text={event.data.text} /></div>;
  }
  if (event.type === "assistant_message") {
    const model = [event.data.provider, event.data.model].filter(Boolean).join("/");
    return (
      <div className="message assistant">
        <Markdown text={event.data.text} />
        {model && <span className="message-meta">回答模型：{model}</span>}
      </div>
    );
  }
  if (event.type === "error") {
    return <div className="message error" role="alert"><strong>错误：</strong>{event.data.message}</div>;
  }
  if (event.type === "tool_start") {
    return (
      <details className="tool-event">
        <summary>🔧 调用工具 <code>{event.data.toolName}</code></summary>
        <pre>{JSON.stringify(event.data.args, null, 2)}</pre>
      </details>
    );
  }
  if (event.type === "tool_end") {
    return (
      <details className={`tool-event ${event.data.isError ? "tool-error" : ""}`}>
        <summary>{event.data.isError ? "⚠ 工具失败" : "✓ 工具结果"} <code>{event.data.toolName}</code>{event.data.durationMs ? ` · ${event.data.durationMs} ms` : ""}</summary>
        <pre>{event.data.text}</pre>
      </details>
    );
  }
  if (event.type === "context_loaded") {
    return <div className="system-note">上下文已按来源重新装配：{event.data.entries} 项，约 {event.data.tokenEstimate} tokens。实验详情仍以持久化记录为准。</div>;
  }
  if (event.type === "context_compacted") {
    return <div className="system-note">Pi 已压缩会话历史（{event.data.reason}）。已确认方案、runId 和来源仍可通过研究上下文工具找回。</div>;
  }
  if (event.type === "model_changed") {
    return (
      <div className="system-note">
        模型已切换为 <code>{String(event.data.provider ?? "")}/{String(event.data.name ?? event.data.id ?? "")}</code>，从下一条消息生效；已有回答保留原模型记录。
      </div>
    );
  }
  const labels: Record<string, string> = {
    plan_drafted: "研究方案草稿已保存，等待用户确认",
    plan_confirmed: "研究方案已由用户确认",
    run_proposed: "实验提案已创建，等待用户批准精确配置",
    run_queued: "实验已进入独立 worker 队列",
    run_verified: "运行核验状态已记录",
    result_created: "已生成可追溯结果版本",
    manuscript_built: "稿件构建已执行",
    material_imported: "材料已保存并记录来源",
    admission_assessed: "复现准入已评估",
    task_created: "任务已创建",
  };
  return <div className="system-note">{labels[event.type] ?? event.type}</div>;
}

function MaterialsPanel(props: {
  projectId: string;
  taskId: string | null;
  materials: Material[];
  onChanged: () => void;
  fail: (error: unknown) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<any[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const searchRevision = useRef(0);
  useEffect(() => { searchRevision.current += 1; setHits([]); setNote(null); }, [props.projectId, props.taskId]);
  const search = async () => {
    if (!query.trim()) return;
    const revision = ++searchRevision.current;
    setBusy(true);
    try {
      const response = await post<any>(`/api/projects/${props.projectId}/search`, { query, taskId: props.taskId });
      if (revision !== searchRevision.current) return;
      setHits(response.hits);
      setNote(response.note ?? (response.hits.length ? null : "未找到结果，请调整检索词。"));
    } catch (error) {
      props.fail(error);
    } finally {
      setBusy(false);
    }
  };
  const importMaterial = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await post(`/api/projects/${props.projectId}/materials`, { ...body, taskId: props.taskId });
      props.onChanged();
    } catch (error) {
      props.fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel-grid">
      <section className="card">
        <h3>检索真实来源</h3>
        <p className="muted">Crossref 通道。一次检索只返回候选，不把“搜索命中”当成论文结论；导入时保存 DOI、时间、许可和哈希。</p>
        <div className="row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="论文标题、DOI、模型名或研究问题" aria-label="检索词" />
          <button onClick={() => void search()} disabled={busy}>检索</button>
        </div>
        {note && <p className="hint">{note}</p>}
        <div className="search-results">
          {hits.map((hit, index) => (
            <div className="search-hit" key={`${hit.doi ?? hit.url}-${index}`}>
              <div>
                <strong>{hit.title}</strong>
                <p className="muted">{hit.authors?.join(", ")} · {hit.year ?? "年份未知"} · {hit.container ?? "venue 未知"}</p>
                <p className="mono small">{hit.doi ?? hit.url}</p>
              </div>
              <button className="secondary small" disabled={!hit.doi || busy} onClick={() => void importMaterial({ doi: hit.doi })}>导入 DOI</button>
            </div>
          ))}
        </div>
        <h4>导入可读材料</h4>
        <div className="stack">
          <div className="row">
            <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="项目内相对路径，如 workspace/paper.pdf" aria-label="材料路径" />
            <button className="secondary" disabled={!path || busy} onClick={() => void importMaterial({ path })}>导入路径</button>
          </div>
          <div className="row">
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://… 可读网页或 PDF" aria-label="材料 URL" />
            <button className="secondary" disabled={!url || busy} onClick={() => void importMaterial({ url })}>导入 URL</button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="row space-between">
          <h3>项目材料 <span className="count">{props.materials.length}</span></h3>
          <a className="button-link" href={`/api/projects/${props.projectId}/materials/bibtex`} target="_blank" rel="noreferrer">导出 BibTeX</a>
        </div>
        <p className="muted">材料在同项目任务间共享来源，不复制全部聊天历史。扫描 PDF 无可提取文本时会明确提示，而不是猜测内容。DOI 重复导入会复用已保存的来源。</p>
        <div className="materials">
          {props.materials.length === 0 && <p className="muted">还没有材料。</p>}
          {props.materials.map((material) => (
            <article className="material" key={material.id}>
              <div className="row space-between">
                <strong>{material.title}</strong>
                <span className="badge">{material.kind}</span>
              </div>
              <p className="mono small">{material.source.channel} · {material.source.doi ?? material.source.url}</p>
              <p className="muted small">获取：{ago(material.source.retrievedAt)} · 许可：{material.source.license ?? "未知"} · SHA256 {material.sha256.slice(0, 12)}…</p>
              {material.source.ambiguity && <p className="hint">歧义：{material.source.ambiguity}</p>}
              {material.note && <details><summary>提取文本/摘要</summary><p className="note-text">{material.note}</p></details>}
              <a className="link" href={`/api/projects/${props.projectId}/materials/${material.id}/file`} target="_blank" rel="noreferrer">查看原始文件</a>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanPanel(props: {
  projectId: string;
  taskId: string | null;
  detail: TaskDetail | null;
  skills: any[];
  onChanged: () => void;
  fail: (error: unknown) => void;
}) {
  const initialForm = {
    objective: "",
    design: "",
    dataset: "",
    split: "test",
    preprocessing: "",
    license: "",
    metricKey: "mae",
    metricLabel: "MAE",
    direction: "lower",
    sourceLocation: "",
    seeds: "1, 2, 3",
    maxMinutes: "30",
    maxRuns: "2",
    resources: "local CPU",
    risks: "",
  };
  const [form, setForm] = useStoredState(`scholarflow.workspace.draft.v1.${props.projectId}.${props.taskId}.PlanPanel`, initialForm, sameShape(initialForm));
  const [admissionJson, setAdmissionJson] = useState("");
  const [busy, setBusy] = useState(false);
  const submitPlan = async () => {
    if (!props.taskId) return;
    setBusy(true);
    try {
      await post(`/api/projects/${props.projectId}/plans`, {
        taskId: props.taskId,
        objective: form.objective,
        hypotheses: [],
        design: form.design,
        conditions: {
          dataset: form.dataset,
          split: form.split,
          preprocessing: form.preprocessing,
          "data.license": form.license,
        },
        metrics: [{
          key: form.metricKey,
          label: form.metricLabel,
          direction: form.direction,
          sourceLocation: form.sourceLocation || "待确认",
        }],
        seed: form.seeds.split(",").map((item) => Number(item.trim())).filter(Number.isFinite),
        budget: { maxMinutes: Number(form.maxMinutes), maxRuns: Number(form.maxRuns) },
        resources: form.resources,
        risks: form.risks.split("\n").filter(Boolean),
      });
      props.onChanged();
    } catch (error) {
      props.fail(error);
    } finally {
      setBusy(false);
    }
  };
  const submitAdmission = async () => {
    if (!props.taskId) return;
    try {
      const parsed = JSON.parse(admissionJson);
      await post(`/api/projects/${props.projectId}/admissions`, { taskId: props.taskId, input: parsed });
      setAdmissionJson("");
      props.onChanged();
    } catch (error) {
      props.fail(error);
    }
  };
  if (!props.taskId) return <div className="empty"><p>先在“任务”面板创建或选择一个任务。</p></div>;
  return (
    <div className="panel-grid">
      <section className="card">
        <h3>实验方案</h3>
        <p className="muted">目标运行只接受已确认方案和材料充分的准入。确认是用户的明确动作；Agent 不能自行确认。</p>
        {(props.detail?.plans ?? []).length === 0 && <p className="muted">还没有方案。可让 Agent 用 save_research_plan 生成，或手动创建。</p>}
        {(props.detail?.plans ?? []).slice().reverse().map((plan) => (
          <article className={`plan ${plan.status}`} key={plan.id}>
            <div className="row space-between">
              <strong>v{plan.version} · {plan.objective}</strong>
              <StatusBadge status={plan.status} />
            </div>
            <p><strong>设计：</strong>{plan.design}</p>
            <p><strong>条件：</strong>{Object.entries(plan.conditions).map(([key, value]) => `${key}=${value}`).join(", ")}</p>
            <p><strong>指标：</strong>{plan.metrics.map((metric) => `${metric.key} (${metric.direction}) @ ${metric.sourceLocation}`).join(", ")}</p>
            <p><strong>种子：</strong>{plan.seed.join(", ")} · <strong>预算：</strong>{plan.budget.maxMinutes} 分钟 / {plan.budget.maxRuns} 次 · {plan.resources}</p>
            {plan.risks.length > 0 && <p><strong>风险：</strong>{plan.risks.join("; ")}</p>}
            {plan.status === "draft" && (
              <div className="row">
                <button onClick={() => void post(`/api/projects/${props.projectId}/plans/${plan.id}/confirm`).then(props.onChanged).catch(props.fail)}>确认方案</button>
                <button className="secondary" onClick={() => void post(`/api/projects/${props.projectId}/plans/${plan.id}/reject`).then(props.onChanged).catch(props.fail)}>拒绝</button>
              </div>
            )}
          </article>
        ))}
        <details>
          <summary>手动创建方案</summary>
          <form className="stack" onSubmit={(event) => { event.preventDefault(); void submitPlan(); }}>
            <input placeholder="目标" value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} />
            <textarea rows={3} placeholder="设计" value={form.design} onChange={(event) => setForm({ ...form, design: event.target.value })} />
            <div className="grid-2">
              <input placeholder="dataset" value={form.dataset} onChange={(event) => setForm({ ...form, dataset: event.target.value })} />
              <input placeholder="split" value={form.split} onChange={(event) => setForm({ ...form, split: event.target.value })} />
              <input placeholder="preprocessing" value={form.preprocessing} onChange={(event) => setForm({ ...form, preprocessing: event.target.value })} />
              <input placeholder="data license" value={form.license} onChange={(event) => setForm({ ...form, license: event.target.value })} />
              <input placeholder="metric key" value={form.metricKey} onChange={(event) => setForm({ ...form, metricKey: event.target.value })} />
              <input placeholder="metric label" value={form.metricLabel} onChange={(event) => setForm({ ...form, metricLabel: event.target.value })} />
              <select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}>
                <option value="lower">lower is better</option>
                <option value="higher">higher is better</option>
              </select>
              <input placeholder="指标在论文中的位置" value={form.sourceLocation} onChange={(event) => setForm({ ...form, sourceLocation: event.target.value })} />
              <input placeholder="seeds: 1, 2, 3" value={form.seeds} onChange={(event) => setForm({ ...form, seeds: event.target.value })} />
              <input placeholder="预算分钟" value={form.maxMinutes} onChange={(event) => setForm({ ...form, maxMinutes: event.target.value })} />
              <input placeholder="预算运行数" value={form.maxRuns} onChange={(event) => setForm({ ...form, maxRuns: event.target.value })} />
              <input placeholder="资源" value={form.resources} onChange={(event) => setForm({ ...form, resources: event.target.value })} />
            </div>
            <textarea rows={2} placeholder="风险（每行一个）" value={form.risks} onChange={(event) => setForm({ ...form, risks: event.target.value })} />
            <button type="submit" disabled={busy}>保存草稿</button>
          </form>
        </details>
      </section>

      <section className="card">
        <h3>复现准入</h3>
        <p className="muted">至少需要官方仓库/commit、官方脚本与参数、可用数据，以及两篇独立第三方实际复现。原论文自报数字和目标运行成功都不算。</p>
        {(props.detail?.admissions ?? []).length === 0 && <p className="muted">还没有准入记录。Agent 使用 assess_admission 记录结构化证据。</p>}
        {(props.detail?.admissions ?? []).map((admission) => (
          <article className="admission" key={admission.id}>
            <div className="row space-between"><strong>{admission.id.slice(0, 12)}</strong><StatusBadge status={admission.status} /></div>
            {admission.missing?.length > 0 && <ul>{admission.missing.map((item: string) => <li key={item}>{item}</li>)}</ul>}
            {admission.pending?.length > 0 && <p className="hint">待核验：{admission.pending.join("; ")}</p>}
            {admission.warnings?.length > 0 && <p className="hint">提示：{admission.warnings.join("; ")}</p>}
          </article>
        ))}
        <details>
          <summary>手动录入准入 JSON（高级）</summary>
          <p className="hint">仅用于用户已有结构化证据时。字段须包含 paper/repository/scripts/data/priorReproductions/target；不完整会被判为 insufficient。</p>
          <textarea rows={8} value={admissionJson} onChange={(event) => setAdmissionJson(event.target.value)} placeholder='{"paper":{...},"repository":{...},"scripts":{...},"data":{...},"priorReproductions":[...],"target":{...}}' />
          <button className="secondary" onClick={() => void submitAdmission()} disabled={!admissionJson.trim()}>评估准入</button>
        </details>
        <h3>项目 Skills</h3>
        <div className="skills">
          {props.skills.map((skill) => (
            <div className="skill" key={skill.name}>
              <strong>{skill.name}</strong> <span className="muted">v{skill.version} · {skill.license}</span>
              <p className="mono small">sha256 {skill.sha256.slice(0, 16)}… · 来源 {skill.sourcePath}</p>
              {skill.missingDependencies.length > 0 && <p className="hint">缺少依赖：{skill.missingDependencies.join(", ")}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ExperimentsPanel(props: {
  projectId: string;
  taskId: string | null;
  approvals: Approval[];
  runs: RunSummary[];
  settings: Settings | null;
  confirmedPlan: Plan | null;
  onChanged: () => void;
  fail: (error: unknown) => void;
}) {
  const [log, setLog] = useState<{ runId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const initialForm = {
    name: "smoke-check",
    program: "",
    args: "workspace/smoke.mjs",
    cwd: "workspace",
    metricFile: "metrics.json",
    metricKey: "value",
    pointer: "/value",
    timeoutSeconds: "60",
  };
  const [form, setForm] = useStoredState(`scholarflow.workspace.draft.v1.${props.projectId}.${props.taskId}.ExperimentsPanel`, initialForm, sameShape(initialForm));
  const decide = async (approval: Approval, action: "approve" | "reject") => {
    setBusy(true);
    try {
      await post(`/api/projects/${props.projectId}/approvals/${approval.id}/${action}`);
      props.onChanged();
    } catch (error) {
      props.fail(error);
    } finally {
      setBusy(false);
    }
  };
  const proposeSmoke = async () => {
    if (!props.taskId || !props.confirmedPlan) return;
    setBusy(true);
    try {
      await post(`/api/projects/${props.projectId}/runs/proposals`, {
        taskId: props.taskId,
        name: form.name,
        kind: "smoke",
        planId: props.confirmedPlan.id,
        program: form.program || undefined,
        args: form.args.split(/\s+/).filter(Boolean),
        cwd: form.cwd,
        config: props.confirmedPlan.conditions,
        seed: props.confirmedPlan.seed,
        metrics: [{ key: form.metricKey, label: form.metricKey, direction: "lower", file: form.metricFile, pointer: form.pointer }],
        timeoutSeconds: Number(form.timeoutSeconds),
        expectedArtifacts: [form.metricFile],
      });
      props.onChanged();
    } catch (error) {
      props.fail(error);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (run: RunSummary) => {
    try {
      const result = await post<any>(`/api/projects/${props.projectId}/runs/${run.id}/cancel`);
      if (!result.cancelled) window.alert(result.reason);
      props.onChanged();
    } catch (error) {
      props.fail(error);
    }
  };
  const verify = async (run: RunSummary) => {
    const note = window.prompt("核验说明：你检查了哪些条件/原始文件？成功退出码本身不算核验。");
    if (!note) return;
    try {
      await post(`/api/projects/${props.projectId}/runs/${run.id}/verify`, { status: "verified", note });
      props.onChanged();
    } catch (error) {
      props.fail(error);
    }
  };
  const showLog = async (run: RunSummary) => {
    try {
      const response = await api<{ log: string }>(`/api/projects/${props.projectId}/runs/${run.id}/log?lines=250`);
      setLog({ runId: run.id, text: response.log });
    } catch (error) {
      props.fail(error);
    }
  };
  return (
    <div className="stack">
      <section className="card">
        <h3>待批准提案 <span className="count">{props.approvals.filter((item) => item.status === "pending").length}</span></h3>
        <p className="muted">批准针对精确配置指纹。同一 requestId 重试不会启动第二个进程；worker 单并发；浏览器断开不影响训练。</p>
        {props.approvals.filter((item) => item.status === "pending").length === 0 && <p className="muted">没有待批准提案。Agent 提议后会停在这里等待你。</p>}
        {props.approvals.filter((item) => item.status === "pending").map((approval) => (
          <article className="approval" key={approval.id}>
            <div className="row space-between">
              <strong>{approval.spec.name} <span className="badge">{approval.spec.kind}</span></strong>
              <span className="mono small">{approval.fingerprint.slice(0, 16)}…</span>
            </div>
            <p className="mono small">{approval.spec.program} {approval.spec.args.join(" ")}</p>
            <p className="small">cwd={approval.spec.cwd} · seed={approval.spec.seed.join(",")} · timeout={approval.spec.resourceLimits.timeoutSeconds}s · metrics={approval.spec.metrics.map((metric) => `${metric.key}@${metric.file}#${metric.pointer}`).join(", ")}</p>
            <p className="small">数据：{Object.entries(approval.spec.data).map(([key, value]) => `${key}=${value}`).join(", ")}</p>
            <p className="hint">{approval.reason}</p>
            <div className="row">
              <button disabled={busy} onClick={() => void decide(approval, "approve")}>批准并排队</button>
              <button className="secondary" disabled={busy} onClick={() => void decide(approval, "reject")}>拒绝</button>
            </div>
          </article>
        ))}
        <details>
          <summary>手动提议 smoke 运行（调试管线）</summary>
          {!props.confirmedPlan ? <p className="hint">先确认一个实验方案。smoke 永远不是复现证据。</p> : (
            <form className="stack" onSubmit={(event) => { event.preventDefault(); void proposeSmoke(); }}>
              <div className="grid-2">
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="名称" />
                <input value={form.program} onChange={(event) => setForm({ ...form, program: event.target.value })} placeholder="解释器绝对路径（留空使用默认 Node，仅 smoke）" />
                <input value={form.args} onChange={(event) => setForm({ ...form, args: event.target.value })} placeholder="参数（空格分隔）" />
                <input value={form.cwd} onChange={(event) => setForm({ ...form, cwd: event.target.value })} placeholder="cwd（项目内）" />
                <input value={form.metricFile} onChange={(event) => setForm({ ...form, metricFile: event.target.value })} placeholder="metrics.json" />
                <input value={form.pointer} onChange={(event) => setForm({ ...form, pointer: event.target.value })} placeholder="/value" />
                <input value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: event.target.value })} placeholder="timeout seconds" />
              </div>
              <p className="hint">默认解释器：{props.settings?.experiment.defaultInterpreter || "Node（仅 smoke）"}。目标运行必须使用显式绝对 Python/Conda 路径和已充分准入的材料。</p>
              <button type="submit" disabled={busy}>创建待批准提案</button>
            </form>
          )}
        </details>
      </section>

      <section className="card">
        <h3>运行记录 <span className="count">{props.runs.length}</span></h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>状态</th><th>类型</th><th>核验</th><th>退出码</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>
              {props.runs.map((run) => (
                <tr key={run.id}>
                  <td><strong>{run.name}</strong><div className="mono small">{run.id.slice(0, 16)}…</div><div className="mono small">fp {run.fingerprint.slice(0, 12)}…</div></td>
                  <td><StatusBadge status={run.status} />{run.error && <div className="hint">{run.error}</div>}</td>
                  <td><span className="badge">{run.kind}</span></td>
                  <td><StatusBadge status={run.verification} /></td>
                  <td>{run.exitCode ?? "—"}</td>
                  <td className="small">{ago(run.startedAt)}<br />{ago(run.finishedAt)}</td>
                  <td className="actions">
                    <button className="secondary small" onClick={() => void showLog(run)}>日志</button>
                    {run.status === "running" || run.status === "unknown" ? <button className="secondary small" onClick={() => void cancel(run)}>取消</button> : null}
                    {run.status === "succeeded" || run.status === "failed" ? <button className="secondary small" onClick={() => void verify(run)}>核验</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {props.runs.length === 0 && <p className="muted">还没有运行。目标运行需要确认方案 + 材料充分准入 + 用户批准。</p>}
        {log && (
          <div className="log-view">
            <div className="row space-between"><strong>日志 {log.runId}</strong><button className="link" onClick={() => setLog(null)}>关闭</button></div>
            <pre>{log.text || "(空)"}</pre>
          </div>
        )}
      </section>
    </div>
  );
}

function ResultsPanel(props: {
  projectId: string;
  taskId: string | null;
  runs: RunSummary[];
  results: ResultVersion[];
  onChanged: () => void;
  fail: (error: unknown) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("Baseline comparison");
  const [supersedes, setSupersedes] = useState("");
  const analyze = async () => {
    if (!props.taskId || selected.length === 0) return;
    try {
      await post(`/api/projects/${props.projectId}/results/analyze`, {
        taskId: props.taskId,
        runIds: selected,
        title,
        supersedes: supersedes || undefined,
      });
      props.onChanged();
    } catch (error) {
      props.fail(error);
    }
  };
  return (
    <div className="stack">
      <section className="card">
        <h3>从指定运行导入并比较</h3>
        <p className="muted">数值只从本次运行的原始文件读取；缺失/非数值/条件不一致会明确标注。不可比时不做排名，也不生成误导性图表。</p>
        <div className="run-select">
          {props.runs.map((run) => (
            <label key={run.id} className="check-row">
              <input
                type="checkbox"
                checked={selected.includes(run.id)}
                onChange={(event) => setSelected(event.target.checked ? [...selected, run.id] : selected.filter((id) => id !== run.id))}
              />
              <span><strong>{run.name}</strong> <span className="mono small">{run.id}</span> <StatusBadge status={run.status} /> <StatusBadge status={run.verification} /> <span className="badge">{run.kind}</span></span>
            </label>
          ))}
          {props.runs.length === 0 && <p className="muted">还没有运行。</p>}
        </div>
        <div className="row">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="结果标题" />
          <select value={supersedes} onChange={(event) => setSupersedes(event.target.value)}>
            <option value="">不替换旧版本</option>
            {props.results.filter((result) => result.status === "current").map((result) => <option key={result.id} value={result.id}>替换 {result.title} ({result.id.slice(0, 10)}…)</option>)}
          </select>
          <button disabled={selected.length === 0 || !props.taskId} onClick={() => void analyze()}>分析所选运行</button>
        </div>
      </section>

      {props.results.map((result) => (
        <section className={`card result ${result.status}`} key={result.id}>
          <div className="row space-between">
            <h3>{result.title}</h3>
            <div className="row"><span className={`badge ${result.comparability.comparable ? "status-succeeded" : "status-partial"}`}>{result.comparability.comparable ? "条件可比" : "不可直接比较"}</span><span className="badge">{result.status}</span></div>
          </div>
          <p className="mono small">{result.id} · {ago(result.createdAt)} · runs {result.runIds.join(", ")}</p>
          {result.comparability.keyDifferences.length > 0 && <div className="notice"><strong>关键差异：</strong><ul>{result.comparability.keyDifferences.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {result.comparability.warnings.length > 0 && <div className="notice warn-box"><strong>限制：</strong><ul>{result.comparability.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>运行</th>{Object.keys(result.table[0]?.values ?? {}).map((key) => <th key={key}>{key}</th>)}<th>条件组</th></tr></thead>
              <tbody>
                {result.table.map((row) => (
                  <tr key={row.runId}>
                    <td>{row.runName}<div className="mono small">{row.runId}</div></td>
                    {Object.entries(row.values).map(([key, value]) => <td key={key}>{value.value}{value.unit ? ` ${value.unit}` : ""}<div className="mono small">{value.source}</div></td>)}
                    <td className="mono small">{row.comparableGroup}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.chartPath && (
            <figure>
              <img src={`/api/projects/${props.projectId}/manuscript/download?path=${encodeURIComponent(result.chartPath)}`} alt={`${result.title} chart`} />
              <figcaption className="muted small">图表仅在所有条件一致时生成，来源：{result.chartPath}</figcaption>
            </figure>
          )}
          {result.affectedArtifacts.length > 0 && <p className="hint">替换后待核对：{result.affectedArtifacts.join(", ")}</p>}
          <div className="row">
            <a className="link" href={`/api/projects/${props.projectId}/manuscript/download?path=${encodeURIComponent(result.reportPath)}`} target="_blank" rel="noreferrer">打开报告</a>
            {result.chartPath && <a className="link" href={`/api/projects/${props.projectId}/manuscript/download?path=${encodeURIComponent(result.chartPath)}`} target="_blank" rel="noreferrer">下载图表 SVG</a>}
          </div>
        </section>
      ))}
      {props.results.length === 0 && <div className="empty small"><p>还没有结果版本。选择运行后分析，数值会绑定 runId、文件、JSON pointer 和条件。</p></div>}
    </div>
  );
}

function ManuscriptPanel(props: {
  onReference: (reference: MessageReference) => void;
  projectId: string;
  taskId: string | null;
  requestedFile?: string | null;
  closingFile?: string | null;
  onDirtyFiles?: (files: string[]) => void;
  onCloseComplete?: (close: boolean) => void;
  data: { files: any[]; versions: ManuscriptVersion[]; latestBuild: ManuscriptVersion | null; sourceHash: string } | null;
  build: ManuscriptVersion | null;
  onChanged: () => void;
  fail: (error: unknown) => void;
}) {
  const draftOwner = `${props.projectId}.${props.taskId}`;
  const [file, setFile] = useStoredState(`scholarflow.workspace.file.v1.${draftOwner}`, "main.tex", isString);
  type FileDraft = { content: string; baseHash: string };
  const [fileDrafts, setFileDrafts] = useStoredState<Record<string, FileDraft>>(`scholarflow.workspace.editor.v1.${draftOwner}`, {}, (v): v is Record<string, FileDraft> => !!v && typeof v === "object" && Object.values(v).every((d) => !!d && typeof d.content === "string" && typeof d.baseHash === "string"));
  const [remote, setRemote] = useState<{ owner: string; file: string; content: string; hash: string } | null>(null);
  const draft = fileDrafts[file];
  const content = draft?.content ?? (remote?.owner === draftOwner && remote.file === file ? remote.content : "");
  const setContent = (value: string) => setFileDrafts((s) => ({ ...s, [file]: { content: value, baseHash: draft?.baseHash ?? remote?.hash ?? "" } }));
  const [editorMode, setEditorMode] = useStoredState(`scholarflow.workspace.editor.mode.v1.${draftOwner}`, "source", (v): v is string => ["source", "pdf", "compare"].includes(String(v)));
  const [compareSide, setCompareSide] = useStoredState(`scholarflow.workspace.editor.side.v1.${draftOwner}`, "source", (v): v is string => v === "source" || v === "pdf");
  const [leaveFile, setLeaveFile] = useState<string | null>(null);
  const fileRequest = useRef(0);
  const dirty = !!draft && draft.content !== remote?.content;
  const conflict = !!draft && !!remote && remote.owner === draftOwner && remote.file === file && draft.baseHash !== remote.hash;
  useEffect(() => { props.onDirtyFiles?.(Object.keys(fileDrafts)); }, [fileDrafts, props.onDirtyFiles]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  const [selection, setSelection] = useState({ start: 0, end: 0, quote: "" });
  const [exported, setExported] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState("");
  const textFiles = (props.data?.files ?? []).filter((entry) => entry.kind === "text");

  const loadFile = useCallback(async (target: string) => {
    const seq = ++fileRequest.current;
    try {
      const response = await api<{ content: string; hash: string }>(`/api/projects/${props.projectId}/manuscript/file?path=${encodeURIComponent(target)}`);
      if (seq !== fileRequest.current) return;
      setFile(target);
      setRemote({ owner: draftOwner, file: target, content: response.content, hash: response.hash });
    } catch (error) {
      props.fail(error);
    }
  }, [props.projectId, props.taskId, props.fail]);

  useEffect(() => {
    const target = props.requestedFile ?? file;
    if (textFiles.some((entry) => entry.path === target)) void loadFile(target);
    return () => { fileRequest.current += 1; };
  }, [draftOwner, props.requestedFile, props.data?.sourceHash]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (Object.keys(fileDrafts).length) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [fileDrafts]);

  useEffect(() => {
    if (!restoreVersion && (props.data?.versions?.length ?? 0) > 0) {
      setRestoreVersion(String(props.data!.versions[0]!.version));
    }
  }, [props.data?.versions, restoreVersion]);

  const restore = async () => {
    if (!restoreVersion) return;
    if (Object.keys(fileDrafts).length && !window.confirm("恢复服务端版本？本地未保存草稿将继续保留，需手动处理冲突。")) return;
    setBusy(true);
    try {
      await post(`/api/projects/${props.projectId}/manuscript/versions/${restoreVersion}/restore`, { taskId: props.taskId });
      await props.onChanged();
      await loadFile("main.tex");
    } catch (error) {
      props.fail(error);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!remote || remote.owner !== draftOwner || remote.file !== file || conflict) return false;
    setBusy(true);
    try {
      await put(`/api/projects/${props.projectId}/manuscript/file`, { path: file, content, baseHash: draft?.baseHash ?? remote.hash, taskId: props.taskId });
      setFileDrafts((s) => { const next = { ...s }; delete next[file]; return next; });
      await loadFile(file);
      props.onChanged();
      return true;
    } catch (error) {
      props.fail(error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const build = async () => {
    setBusy(true);
    setDiagnostics([]);
    try {
      const response = await post<any>(`/api/projects/${props.projectId}/manuscript/build`, { taskId: props.taskId });
      setDiagnostics(response.diagnostics ?? []);
      props.onChanged();
    } catch (error) {
      if (error instanceof ApiError) {
        setDiagnostics(Array.isArray(error.payload?.diagnostics) ? error.payload.diagnostics : [error.message]);
      } else props.fail(error);
    } finally {
      setBusy(false);
    }
  };
  const syncResults = async () => {
    setBusy(true);
    setSyncWarnings([]);
    try {
      const response = await post<{ warnings?: string[] }>(`/api/projects/${props.projectId}/manuscript/results/sync`, { taskId: props.taskId });
      setSyncWarnings(response.warnings ?? []);
      props.onChanged();
    } catch (error) {
      props.fail(error);
    } finally {
      setBusy(false);
    }
  };
  const exportPackage = async () => {
    setBusy(true);
    try {
      const response = await post<{ path: string }>(`/api/projects/${props.projectId}/manuscript/export`);
      setExported(response.path);
      props.onChanged();
    } catch (error) {
      props.fail(error);
    } finally {
      setBusy(false);
    }
  };
  const stale = props.data && props.build?.build.sourceHash && props.data.sourceHash !== props.build.build.sourceHash;
  const chooseFile = (target: string) => { if (dirty) setLeaveFile(target); else void loadFile(target); };
  return (
    <div className="panel-grid manuscript-layout">
      {props.closingFile && <div role="dialog" aria-label="关闭未保存稿件" className="draft-dialog"><p>稿件存在未保存修改。</p><button disabled={busy || conflict || remote?.file !== props.closingFile} onClick={() => void save().then((saved) => { if (saved) props.onCloseComplete?.(true); })}>保存后关闭</button><button onClick={() => { setFileDrafts((s) => { const next = { ...s }; delete next[props.closingFile!]; return next; }); props.onCloseComplete?.(true); }}>放弃后关闭</button><button onClick={() => props.onCloseComplete?.(false)}>取消关闭</button></div>}
      {leaveFile && <div role="dialog" aria-label="未保存的稿件" className="draft-dialog"><p>当前文件有未保存修改。选择下一步。</p><button onClick={() => void save().then((saved) => { if (saved) { void loadFile(leaveFile); setLeaveFile(null); } })}>保存后切换</button><button onClick={() => { setFileDrafts((s) => { const next = { ...s }; delete next[file]; return next; }); void loadFile(leaveFile); setLeaveFile(null); }}>放弃后切换</button><button onClick={() => setLeaveFile(null)}>取消切换</button></div>}
      <details className="card"><summary>稿件文件与构建</summary>
        <h3>稿件文件</h3>
        <p className="muted">每次保存都会创建版本。构建使用受控本地 TeX 命令，禁用 shell escape；旧 PDF 不会冒充新构建。</p>
        <div className="file-list">
          {props.data?.files.map((entry) => (
            <button key={entry.path} className={`file-item ${entry.path === file ? "active" : ""}`} onClick={() => entry.kind === "text" ? chooseFile(entry.path) : undefined} disabled={entry.kind !== "text"}>
              <span>{entry.path}</span>
              <span className="muted small">{entry.kind === "text" ? `${entry.bytes} B` : "figure"}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <select aria-label="稿件版本" value={restoreVersion} onChange={(event) => setRestoreVersion(event.target.value)}>
            {(props.data?.versions ?? []).map((version) => (
              <option key={version.id} value={String(version.version)}>
                v{version.version} · {version.build.status} · {version.snapshotPath ? "可恢复" : "无快照"}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={() => void restore()} disabled={busy || !restoreVersion}>恢复选中版本</button>
        </div>
        <div className="row">
          <button className="secondary" onClick={() => void syncResults()} disabled={busy}>同步结果图表/表格</button>
          <button onClick={() => void build()} disabled={busy}>构建 PDF</button>
          <a className="button-link" href={`/api/projects/${props.projectId}/manuscript/pdf`} target="_blank" rel="noreferrer">打开最新 PDF</a>
          <button className="secondary" onClick={() => void exportPackage()} disabled={busy}>导出投稿包</button>
        </div>
        {syncWarnings.length > 0 && <div className="notice warn-box"><strong>结果同步警告</strong><ul>{syncWarnings.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        {stale && <p className="banner warn">源码在构建后已修改，PDF 已过期。重新构建后才能导出。</p>}
        {props.build?.build.builtAt && <p className="muted small">最近构建：{ago(props.build.build.builtAt)} · 版本 v{props.build.version} · sourceHash {props.build.build.sourceHash?.slice(0, 12)}…</p>}
        {diagnostics.length > 0 && <div className="notice warn-box"><strong>构建诊断</strong><ul>{diagnostics.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        {exported && (
          <p className="notice">投稿包：<code>{exported}</code><br /><a className="link" href={`/api/projects/${props.projectId}/manuscript/download?path=${encodeURIComponent(exported)}`}>下载 zip</a></p>
        )}
      </details>
      <section className="card editor-card">
        <label>稿件视图<select aria-label="稿件视图" value={editorMode} onChange={(e) => setEditorMode(e.target.value)}><option value="source">源码</option><option value="pdf">PDF</option><option value="compare">源码与 PDF 对照</option></select></label>
        <div className="row space-between">
          <h3>{file}</h3>
          <div className="row"><button disabled={dirty || !selection.quote || selection.quote.length > 4000 || busy} onClick={() => {
            const version = props.data?.versions.find((v) => v.files.some((f) => f.path === file && f.sha256 === remote?.hash));
            if (!version) { props.fail(new Error("请先保存稿件版本再引用选区")); return; }
            props.onReference({ kind: "manuscript", id: version.id, version: remote!.hash, file, ...selection });
          }}>引用稿件选区</button><button onClick={() => void save()} disabled={busy || conflict || !remote}>保存新版本</button></div>
        </div>
        {conflict && <div role="alert" className="notice warn-box">草稿与服务端版本冲突，禁止覆盖。<button onClick={() => { setFileDrafts((s) => { const next = { ...s }; delete next[file]; return next; }); }}>放弃本地草稿</button><details><summary>比较服务端正文</summary><pre>{remote?.content}</pre></details></div>}
        {dirty && <p role="status">未保存修改 · 本地草稿保留</p>}
        {stale && <p className="pdf-stale-note" role="status">源码已修改，当前 PDF 对应上次成功构建；请重新构建。</p>}
        {editorMode === "compare" && <div className="compare-side-toggle" role="group" aria-label="窄屏对照内容"><button aria-pressed={compareSide === "source"} onClick={() => setCompareSide("source")}>源码</button><button aria-pressed={compareSide === "pdf"} onClick={() => setCompareSide("pdf")}>PDF</button><span>空间不足时切换查看，另一侧位置保留</span></div>}
        <div className={`source-preview ${editorMode}`} data-side={compareSide}>
          {editorMode !== "pdf" && <div className="code-editor"><div className="code-gutter" aria-hidden="true">{content.split("\n").map((_, i) => <span key={i}>{i + 1}</span>)}</div><textarea className="editor" value={content} disabled={!remote || remote.owner !== draftOwner} onSelect={(event) => { const target = event.currentTarget; setSelection({ start: target.selectionStart, end: target.selectionEnd, quote: target.value.slice(target.selectionStart, target.selectionEnd) }); }} onScroll={(event) => { if (event.currentTarget.previousElementSibling) event.currentTarget.previousElementSibling.scrollTop = event.currentTarget.scrollTop; }} onChange={(event) => setContent(event.target.value)} spellCheck={false} aria-label={`编辑 ${file}`} /></div>}
          {editorMode !== "source" && (props.build ? <PdfPreview title="稿件 PDF" url={`/api/projects/${props.projectId}/manuscript/pdf?v=${props.build.version}`} /> : <p>尚无成功构建，请先构建 PDF。</p>)}
        </div>
      </section>
    </div>
  );
}

function SettingsPanel(props: {
  settings: Settings | null;
  health: any;
  onSaved: () => Promise<void>;
  fail: (error: unknown) => void;
}) {
  const [form, setForm] = useState({
    deepseekApiKey: "",
    clearKey: false,
    modelId: "deepseek-flash",
    searchEmail: "",
    defaultInterpreter: "",
    pdflatexPath: "pdflatex",
    latexmkPath: "latexmk",
    defaultTimeoutSeconds: "1800",
    maxTargetRunsPerTask: "2",
  });
  useEffect(() => {
    if (!props.settings) return;
    setForm((previous) => ({
      ...previous,
      modelId: props.settings!.model.id,
      searchEmail: props.settings!.search.contactEmail,
      defaultInterpreter: props.settings!.experiment.defaultInterpreter,
      pdflatexPath: props.settings!.latex.pdflatex,
      latexmkPath: props.settings!.latex.latexmk,
      defaultTimeoutSeconds: String(props.settings!.experiment.defaultTimeoutSeconds),
      maxTargetRunsPerTask: String(props.settings!.experiment.maxTargetRunsPerTask),
    }));
  }, [props.settings]);
  if (!props.settings) return <div className="empty"><p>正在读取设置…</p></div>;
  return (
    <div className="panel-grid">
      <section className="card">
        <h3>模型与检索</h3>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void put("/api/settings", {
              deepseekApiKey: form.deepseekApiKey || undefined,
              clearDeepseekKey: form.clearKey,
              modelId: form.modelId,
              searchEmail: form.searchEmail,
              defaultInterpreter: form.defaultInterpreter,
              pdflatexPath: form.pdflatexPath,
              latexmkPath: form.latexmkPath,
              defaultTimeoutSeconds: Number(form.defaultTimeoutSeconds),
              maxTargetRunsPerTask: Number(form.maxTargetRunsPerTask),
            }).then(props.onSaved).catch(props.fail);
          }}
        >
          <label>DeepSeek API Key（{props.settings.model.configured ? "已配置，留空保持不变" : "未配置"}）
            <input type="password" autoComplete="off" value={form.deepseekApiKey} onChange={(event) => setForm({ ...form, deepseekApiKey: event.target.value })} placeholder="sk-…（只存宿主配置，不进入项目/日志/导出）" />
          </label>
          <label className="check-row"><input type="checkbox" checked={form.clearKey} onChange={(event) => setForm({ ...form, clearKey: event.target.checked })} /> 清除已保存的 Key</label>
          <label>模型 ID（Pi 实际提供）<input value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })} /></label>
          <label>Crossref 联系邮箱（礼貌池，可选）<input value={form.searchEmail} onChange={(event) => setForm({ ...form, searchEmail: event.target.value })} placeholder="you@example.org" /></label>
          <label>默认实验解释器（目标运行必须是绝对路径）<input value={form.defaultInterpreter} onChange={(event) => setForm({ ...form, defaultInterpreter: event.target.value })} placeholder="C:\Users\…\envs\research\python.exe" /></label>
          <div className="grid-2">
            <label>pdflatex<input value={form.pdflatexPath} onChange={(event) => setForm({ ...form, pdflatexPath: event.target.value })} /></label>
            <label>latexmk<input value={form.latexmkPath} onChange={(event) => setForm({ ...form, latexmkPath: event.target.value })} /></label>
            <label>默认超时（秒）<input value={form.defaultTimeoutSeconds} onChange={(event) => setForm({ ...form, defaultTimeoutSeconds: event.target.value })} /></label>
            <label>每任务目标运行上限<input value={form.maxTargetRunsPerTask} onChange={(event) => setForm({ ...form, maxTargetRunsPerTask: event.target.value })} /></label>
          </div>
          <button type="submit">保存设置</button>
        </form>
      </section>
      <section className="card">
        <h3>能力与边界</h3>
        <dl className="capabilities">
          <dt>数据目录</dt><dd className="mono">{props.settings.dataDir}</dd>
          <dt>配置</dt><dd className="mono">宿主配置目录（与项目数据分离）</dd>
          <dt>Agent</dt><dd>{props.health?.agent?.configured ? "DeepSeek 已配置，真实调用仍可能受网络/限流影响" : "未配置；不会生成假回答"}</dd>
          <dt>Pi</dt><dd>{props.health?.piVersion ?? "1.3.0"} · 提供方/会话/压缩/Skill/工具复用 Pi</dd>
          <dt>pdflatex</dt><dd>{props.health?.latex?.pdflatex?.available ? props.health.latex.pdflatex.version : props.health?.latex?.pdflatex?.error ?? "未探测"}</dd>
          <dt>latexmk</dt><dd>{props.health?.latex?.latexmk?.available ? props.health.latex.latexmk.version : props.health?.latex?.latexmk?.error ?? "不可用"}</dd>
          <dt>检索</dt><dd>Crossref REST · 保存 DOI/时间/许可/响应哈希</dd>
          <dt>Worker</dt><dd>{props.health?.worker?.mode ?? "未知"} · 并发 {props.health?.worker?.concurrency ?? 1}</dd>
        </dl>
        <p className="hint">目录限制不是操作系统沙箱。Pi 工具、Skill 和实验命令拥有宿主权限；只运行你信任的 Skill 和脚本。费用未知时显示未知；硬限制使用轮数、输出量、超时和运行数。</p>
      </section>
    </div>
  );
}
