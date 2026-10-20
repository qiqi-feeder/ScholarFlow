import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  api,
  post,
  put,
  streamTask,
  ApiError,
  type Approval,
  type ManuscriptVersion,
  type Material,
  type Plan,
  type Project,
  type ResultVersion,
  type RunSummary,
  type Settings,
  type StreamEvent,
  type Task,
} from "./api";

type Tab = "work" | "materials" | "plan" | "experiments" | "results" | "manuscript" | "settings";
type TaskDetail = {
  task: Task;
  sessionFile: string | null;
  events: StreamEvent[];
  plans: Plan[];
  admissions: any[];
  approvals: Approval[];
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "work", label: "任务" },
  { id: "materials", label: "材料" },
  { id: "plan", label: "方案与准入" },
  { id: "experiments", label: "实验" },
  { id: "results", label: "结果" },
  { id: "manuscript", label: "稿件" },
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
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem("scholarflow.project"));
  const [overview, setOverview] = useState<any>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [liveText, setLiveText] = useState("");
  const [streamState, setStreamState] = useState<"idle" | "connected" | "reconnecting">("idle");
  const [tab, setTab] = useState<Tab>("work");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [results, setResults] = useState<ResultVersion[]>([]);
  const [manuscript, setManuscript] = useState<{ files: any[]; versions: ManuscriptVersion[]; latestBuild: ManuscriptVersion | null; sourceHash: string } | null>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskDraft, setTaskDraft] = useState({ title: "", objective: "", reviewText: "" });
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [message, setMessage] = useState("");
  const streamAbort = useRef<AbortController | null>(null);
  const selectedProject = projects.find((project) => project.id === projectId) ?? null;

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError) setError(`${err.code}: ${err.message}`);
    else setError((err as Error).message ?? String(err));
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const response = await api<{ projects: Project[] }>("/api/projects");
      setProjects(response.projects);
      const stored = localStorage.getItem("scholarflow.project");
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

  const loadProject = useCallback(async (id: string) => {
    try {
      const [projectOverview, materialsResponse, runsResponse, resultsResponse, manuscriptResponse, skillsResponse] = await Promise.all([
        api<any>(`/api/projects/${id}/overview`),
        api<{ materials: Material[] }>(`/api/projects/${id}/materials`),
        api<{ runs: RunSummary[] }>(`/api/projects/${id}/runs`),
        api<{ results: ResultVersion[] }>(`/api/projects/${id}/results`),
        api<any>(`/api/projects/${id}/manuscript`),
        api<{ skills: any[] }>(`/api/projects/${id}/skills`),
      ]);
      setOverview(projectOverview);
      setTasks(projectOverview.tasks);
      setMaterials(materialsResponse.materials);
      setRuns(runsResponse.runs);
      setResults(resultsResponse.results);
      setManuscript(manuscriptResponse);
      setSkills(skillsResponse.skills);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const loadTask = useCallback(async (project: string, task: string) => {
    try {
      const response = await api<TaskDetail>(`/api/projects/${project}/tasks/${task}`);
      setDetail(response);
      setEvents(response.events);
      setLiveText("");
      localStorage.setItem(`scholarflow.task.${project}`, task);
      const after = response.events.reduce((max, event) => Math.max(max, event.seq), 0);
      streamAbort.current?.abort();
      const controller = new AbortController();
      streamAbort.current = controller;
      setStreamState("reconnecting");
      void streamTask(
        `/api/projects/${project}/tasks/${task}/events/stream`,
        after,
        (event) => {
          if (event.type === "assistant_delta") {
            setLiveText((previous) => previous + (event.data.text ?? ""));
            return;
          }
          if (event.type === "assistant_message") setLiveText("");
          if (event.seq > 0) {
            setEvents((previous) => (previous.some((item) => item.seq === event.seq) ? previous : [...previous, event]));
          }
          if (["plan_drafted", "run_proposed", "run_queued", "result_created", "manuscript_built", "material_imported", "admission_assessed", "task_created"].includes(event.type)) {
            void loadProject(project);
            void api<TaskDetail>(`/api/projects/${project}/tasks/${task}`).then((fresh) => {
              setDetail(fresh);
            }).catch(() => undefined);
          }
        },
        controller.signal,
        (state) => setStreamState(state === "closed" ? "idle" : state),
      );
    } catch (err) {
      fail(err);
    }
  }, [fail, loadProject]);

  useEffect(() => {
    void loadProjects();
    void loadSettings();
  }, [loadProjects, loadSettings]);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("scholarflow.project", projectId);
    setTaskId(null);
    setDetail(null);
    setEvents([]);
    setLiveText("");
    void loadProject(projectId);
    const storedTask = localStorage.getItem(`scholarflow.task.${projectId}`);
    if (storedTask) {
      setTaskId(storedTask);
      void loadTask(projectId, storedTask);
    }
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
      setTaskId(response.task.id);
      await loadTask(projectId, response.task.id);
      setTab("work");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async () => {
    if (!projectId || !taskId || !message.trim() || busy) return;
    setBusy(true);
    const text = message;
    setMessage("");
    try {
      await post(`/api/projects/${projectId}/tasks/${taskId}/messages`, {
        text,
        clientId: `msg_${crypto.randomUUID()}`,
      });
    } catch (err) {
      fail(err);
      setMessage(text);
    } finally {
      setBusy(false);
    }
  };

  const stopAnswer = async () => {
    if (!projectId || !taskId) return;
    try {
      await post(`/api/projects/${projectId}/tasks/${taskId}/stop`);
    } catch (err) {
      fail(err);
    }
  };

  const currentApprovals = detail?.approvals ?? [];
  const pendingApprovals = currentApprovals.filter((approval) => approval.status === "pending");
  const confirmedPlan = detail?.plans.find((plan) => plan.status === "confirmed") ?? null;
  const currentManuscriptBuild = manuscript?.latestBuild ?? null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">SF</div>
          <div>
            <h1>ScholarFlow</h1>
            <p>Agentic research workspace</p>
          </div>
        </div>
        <div className="project-list">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-item ${project.id === projectId ? "active" : ""}`}
              onClick={() => setProjectId(project.id)}
            >
              <span className="project-name">{project.name}</span>
              <span className="project-meta">{project.id.slice(0, 10)}</span>
            </button>
          ))}
        </div>
        <NewProject onCreate={createProject} />
        <div className="sidebar-foot">
          <span className={`dot ${streamState === "connected" ? "ok" : streamState === "reconnecting" ? "warn" : ""}`} />
          {streamState === "connected" ? "事件流已连接" : streamState === "reconnecting" ? "事件流重连中" : "事件流未连接"}
          <br />
          <span className="muted">单用户 · 仅回环地址</span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h2>{selectedProject?.name ?? "选择或创建项目"}</h2>
            <p className="muted">{selectedProject?.description || "同一项目共享有来源的材料和运行；聊天历史按任务隔离。"}</p>
          </div>
          <div className="topbar-actions">
            {health && (
              <button className="chip" onClick={() => setTab("settings")} title={health.latex?.pdflatex?.available ? "LaTeX 可用" : "LaTeX 不可用"}>
                Agent {health.agent?.configured ? "已配置" : "未配置"} · TeX {health.latex?.pdflatex?.available ? "OK" : "缺"}
              </button>
            )}
            <button className="chip" onClick={() => void loadProject(projectId!)} disabled={!projectId}>刷新</button>
          </div>
        </header>

        <ErrorBanner error={error} clear={() => setError(null)} />
        {settings && !settings.model.configured && (
          <div className="banner warn">
            DeepSeek 未配置：真实 Agent 对话会返回明确的配置错误，不会生成假回答。前往
            <button className="link" onClick={() => setTab("settings")}>设置</button>
            配置 Key。
          </div>
        )}

        {!selectedProject ? (
          <section className="empty">
            <h3>开始一个研究项目</h3>
            <p>项目拥有独立的材料、任务、实验、结果和稿件。点击左侧“新建项目”。</p>
          </section>
        ) : (
          <>
            <nav className="tabs" role="tablist">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={tab === item.id}
                  className={tab === item.id ? "active" : ""}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {item.id === "experiments" && pendingApprovals.length > 0 && <span className="count">{pendingApprovals.length}</span>}
                </button>
              ))}
            </nav>

            {tab === "work" && (
              <WorkPanel
                tasks={tasks}
                taskId={taskId}
                detail={detail}
                events={events}
                liveText={liveText}
                busy={busy}
                message={message}
                setMessage={setMessage}
                sendMessage={sendMessage}
                stopAnswer={stopAnswer}
                showTaskForm={showTaskForm}
                setShowTaskForm={setShowTaskForm}
                taskDraft={taskDraft}
                setTaskDraft={setTaskDraft}
                createTask={createTask}
                selectTask={(id) => {
                  setTaskId(id);
                  if (projectId) void loadTask(projectId, id);
                }}
                pendingApprovals={pendingApprovals}
                openExperiments={() => setTab("experiments")}
                loadProject={() => projectId && void loadProject(projectId)}
              />
            )}

            {tab === "materials" && projectId && (
              <MaterialsPanel
                projectId={projectId}
                taskId={taskId}
                materials={materials}
                onChanged={() => void loadProject(projectId)}
                fail={fail}
              />
            )}

            {tab === "plan" && projectId && (
              <PlanPanel
                projectId={projectId}
                taskId={taskId}
                detail={detail}
                skills={skills}
                onChanged={() => {
                  void loadProject(projectId);
                  if (taskId) void loadTask(projectId, taskId);
                }}
                fail={fail}
              />
            )}

            {tab === "experiments" && projectId && (
              <ExperimentsPanel
                projectId={projectId}
                taskId={taskId}
                approvals={currentApprovals}
                runs={runs}
                settings={settings}
                confirmedPlan={confirmedPlan}
                onChanged={() => {
                  void loadProject(projectId);
                  if (taskId) void loadTask(projectId, taskId);
                }}
                fail={fail}
              />
            )}

            {tab === "results" && projectId && (
              <ResultsPanel
                projectId={projectId}
                taskId={taskId}
                runs={runs}
                results={results}
                onChanged={() => projectId && void loadProject(projectId)}
                fail={fail}
              />
            )}

            {tab === "manuscript" && projectId && (
              <ManuscriptPanel
                key={projectId}
                projectId={projectId}
                taskId={taskId}
                data={manuscript}
                build={currentManuscriptBuild}
                onChanged={() => void loadProject(projectId)}
                fail={fail}
              />
            )}

            {tab === "settings" && (
              <SettingsPanel
                settings={settings}
                health={health}
                onSaved={async () => {
                  await loadSettings();
                  if (projectId) await loadProject(projectId);
                }}
                fail={fail}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function WorkPanel(props: {
  tasks: Task[];
  taskId: string | null;
  detail: TaskDetail | null;
  events: StreamEvent[];
  liveText: string;
  busy: boolean;
  message: string;
  setMessage: (value: string) => void;
  sendMessage: () => Promise<void>;
  stopAnswer: () => Promise<void>;
  showTaskForm: boolean;
  setShowTaskForm: (value: boolean) => void;
  taskDraft: { title: string; objective: string; reviewText: string };
  setTaskDraft: (value: { title: string; objective: string; reviewText: string }) => void;
  createTask: () => Promise<void>;
  selectTask: (id: string) => void;
  pendingApprovals: Approval[];
  openExperiments: () => void;
  loadProject: () => void;
}) {
  const chatEnd = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [props.events.length, props.liveText]);
  const eventNodes = props.events.filter((event) =>
    ["user_message", "assistant_message", "error", "tool_start", "tool_end", "context_loaded", "plan_drafted", "plan_confirmed", "run_proposed", "run_queued", "run_verified", "result_created", "manuscript_built", "material_imported", "admission_assessed", "task_created", "context_compacted"].includes(event.type),
  );
  return (
    <div className="work-layout">
      <section className="task-column">
        <div className="section-head">
          <h3>研究任务</h3>
          <button className="secondary small" onClick={() => props.setShowTaskForm(!props.showTaskForm)}>
            {props.showTaskForm ? "收起" : "＋ 新任务"}
          </button>
        </div>
        {props.showTaskForm && (
          <form
            className="stack card"
            onSubmit={(event) => {
              event.preventDefault();
              void props.createTask();
            }}
          >
            <input
              placeholder="任务标题，例如：复现基线并检验学习率修改"
              value={props.taskDraft.title}
              onChange={(event) => props.setTaskDraft({ ...props.taskDraft, title: event.target.value })}
              aria-label="任务标题"
            />
            <textarea
              placeholder="目标：明确的科研问题、约束和交付物"
              rows={4}
              value={props.taskDraft.objective}
              onChange={(event) => props.setTaskDraft({ ...props.taskDraft, objective: event.target.value })}
              aria-label="任务目标"
            />
            <textarea
              placeholder="可选：导入审稿意见。它作为数据进入本任务，不会自动改变项目规则。"
              rows={3}
              value={props.taskDraft.reviewText}
              onChange={(event) => props.setTaskDraft({ ...props.taskDraft, reviewText: event.target.value })}
              aria-label="审稿意见"
            />
            <button type="submit" disabled={props.busy}>创建任务</button>
          </form>
        )}
        <div className="task-list">
          {props.tasks.length === 0 && <p className="muted">还没有任务。建立独立目标时才创建新任务；切换面板不会创建会话。</p>}
          {props.tasks.map((task) => (
            <button
              key={task.id}
              className={`task-item ${task.id === props.taskId ? "active" : ""}`}
              onClick={() => props.selectTask(task.id)}
            >
              <span className="task-title">{task.title}</span>
              <span className="task-meta"><StatusBadge status={task.status} /> {ago(task.updatedAt)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="chat-column">
        {!props.detail ? (
          <div className="empty small">
            <h3>选择一个任务</h3>
            <p>任务拥有独立的 Pi 会话。刷新或重启后从持久化事件恢复；不会因切换面板创建新会话。</p>
          </div>
        ) : (
          <>
            <div className="chat-head">
              <div>
                <h3>{props.detail.task.title}</h3>
                <p className="muted">{props.detail.task.objective}</p>
              </div>
              <StatusBadge status={props.detail.task.status} />
            </div>
            {props.pendingApprovals.length > 0 && (
              <button className="banner warn button-banner" onClick={props.openExperiments}>
                {props.pendingApprovals.length} 个实验提案等待你批准精确指纹。Agent 不会自行启动。前往实验面板 →
              </button>
            )}
            <div className="chat-log" role="log" aria-live="polite">
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
              <textarea
                rows={3}
                value={props.message}
                onChange={(event) => props.setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void props.sendMessage();
                  }
                }}
                placeholder="描述目标、上传材料路径，或让 Agent 读取 Skill 并推进当前阶段。Enter 发送，Shift+Enter 换行。"
                aria-label="消息"
              />
              <div className="composer-actions">
                <span className="muted">停止回答 ≠ 取消实验</span>
                <button type="button" className="secondary" onClick={() => void props.stopAnswer()}>停止回答</button>
                <button type="submit" disabled={props.busy || !props.message.trim()}>发送</button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function ChatEvent({ event }: { event: StreamEvent }) {
  if (event.type === "user_message") {
    return <div className="message user"><Markdown text={event.data.text} /></div>;
  }
  if (event.type === "assistant_message") {
    return <div className="message assistant"><Markdown text={event.data.text} /></div>;
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
  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const response = await post<any>(`/api/projects/${props.projectId}/search`, { query, taskId: props.taskId });
      setHits(response.hits);
      setNote(response.note ?? null);
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
        <h3>项目材料 <span className="count">{props.materials.length}</span></h3>
        <p className="muted">材料在同项目任务间共享来源，不复制全部聊天历史。扫描 PDF 无可提取文本时会明确提示，而不是猜测内容。</p>
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
  const [form, setForm] = useState({
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
  });
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
  const [form, setForm] = useState({
    name: "smoke-check",
    program: "",
    args: "workspace/smoke.mjs",
    cwd: "workspace",
    metricFile: "metrics.json",
    metricKey: "value",
    pointer: "/value",
    timeoutSeconds: "60",
  });
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
  projectId: string;
  taskId: string | null;
  data: { files: any[]; versions: ManuscriptVersion[]; latestBuild: ManuscriptVersion | null; sourceHash: string } | null;
  build: ManuscriptVersion | null;
  onChanged: () => void;
  fail: (error: unknown) => void;
}) {
  const [file, setFile] = useState("main.tex");
  const [content, setContent] = useState("");
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [exported, setExported] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textFiles = (props.data?.files ?? []).filter((entry) => entry.kind === "text");

  const loadFile = useCallback(async (target: string) => {
    try {
      const response = await api<{ content: string }>(`/api/projects/${props.projectId}/manuscript/file?path=${encodeURIComponent(target)}`);
      setFile(target);
      setContent(response.content);
    } catch (error) {
      props.fail(error);
    }
  }, [props.projectId, props.fail]);

  useEffect(() => {
    const initial = textFiles.find((entry) => entry.path === "main.tex") ?? textFiles[0];
    if (initial && !content) void loadFile(initial.path);
  }, [props.data?.sourceHash]);

  const save = async () => {
    setBusy(true);
    try {
      await put(`/api/projects/${props.projectId}/manuscript/file`, { path: file, content, taskId: props.taskId });
      props.onChanged();
    } catch (error) {
      props.fail(error);
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
  return (
    <div className="panel-grid manuscript-layout">
      <section className="card">
        <h3>稿件文件</h3>
        <p className="muted">每次保存都会创建版本。构建使用受控本地 TeX 命令，禁用 shell escape；旧 PDF 不会冒充新构建。</p>
        <div className="file-list">
          {props.data?.files.map((entry) => (
            <button key={entry.path} className={`file-item ${entry.path === file ? "active" : ""}`} onClick={() => entry.kind === "text" ? void loadFile(entry.path) : undefined} disabled={entry.kind !== "text"}>
              <span>{entry.path}</span>
              <span className="muted small">{entry.kind === "text" ? `${entry.bytes} B` : "figure"}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <button onClick={() => void build()} disabled={busy}>构建 PDF</button>
          <a className="button-link" href={`/api/projects/${props.projectId}/manuscript/pdf`} target="_blank" rel="noreferrer">打开最新 PDF</a>
          <button className="secondary" onClick={() => void exportPackage()} disabled={busy}>导出投稿包</button>
        </div>
        {stale && <p className="banner warn">源码在构建后已修改，PDF 已过期。重新构建后才能导出。</p>}
        {props.build?.build.builtAt && <p className="muted small">最近构建：{ago(props.build.build.builtAt)} · 版本 v{props.build.version} · sourceHash {props.build.build.sourceHash?.slice(0, 12)}…</p>}
        {diagnostics.length > 0 && <div className="notice warn-box"><strong>构建诊断</strong><ul>{diagnostics.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        {exported && (
          <p className="notice">投稿包：<code>{exported}</code><br /><a className="link" href={`/api/projects/${props.projectId}/manuscript/download?path=${encodeURIComponent(exported)}`}>下载 zip</a></p>
        )}
      </section>
      <section className="card editor-card">
        <div className="row space-between">
          <h3>{file}</h3>
          <button onClick={() => void save()} disabled={busy}>保存新版本</button>
        </div>
        <textarea className="editor" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} aria-label={`编辑 ${file}`} />
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
