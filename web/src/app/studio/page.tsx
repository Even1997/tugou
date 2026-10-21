"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button, Dropdown, Select } from "antd";
import { MoreHorizontal, ChevronDown } from "lucide-react";
import { IconButton, StudioTheme } from "./ui";
import { WindowControls } from "./window-controls";
import windowStyles from "./window-controls.module.css";
import { MAX_PROJECT_BYTES } from "./image-limits.js";
import { Layers3, Shapes, Images, Settings2, FolderOpen, Save, Undo2, Redo2, Sun, Moon, ScanLine, FilePlus2, ArrowUpRight, X, RefreshCw, Clock3, AlertCircle, Download } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useStudio } from "./store";
import { blankProject, buildPrompt, recipeFingerprint, recoverProject, uid, now, validateProject, type StudioProject, type Recipe, type PromptModule } from "./model";
import { studioRequest, readAsset, exportProject } from "./client-api";
import { demoProject } from "./demo";
import { PromptWorkspace } from "./prompt-workspace";
import { AssetLibrary } from "./asset-library";
import { LayerPanel } from "./layer-panel";
import { Inspector } from "./layer-inspector";
import { Settings, type ConnectionConfig } from "./settings";
import { ImageToolPanel } from "./image-tool-panel";
import { useToolTasks, useQueuedTasks } from "./use-tool-tasks";
import type { GenerationJob } from "./generation-schema";
import { collectGeneration } from "./collect-generation";
import { TaskOverview } from "./task-overview";
import { isCanvasTask } from "./canvas-tasks";
import type { ToolJob } from "./tool-schema";
import { uniqueReferences } from "./reference-roles.js";
import { applySharedConnection } from "./shared-connection";
import { useCanvasStore, flushCanvasProjects } from "../(user)/canvas/stores/use-canvas-store";
import "./studio.css";

const Editor = dynamic(() => import("./editor"), { ssr: false, loading: () => <div className="empty-state">正在加载图层编辑器…</div> });
const CanvasWorkspace = dynamic(() => import("../(user)/canvas/[id]/canvas-client-page").then((m) => m.InfiniteCanvasPage), { ssr: false, loading: () => <div className="empty-state">正在加载无限画布…</div> });
type ProjectItem = { id: string; name: string; updatedAt: string; layers: number };
type AnalysisResult = { modules: { name: string; kind: string; text: string }[]; recipes: { name: string; moduleNames: string[]; output: string }[] };
export default function StudioPage() {
    const p = useStudio((s) => s.project);
    const edit = useStudio((s) => s.edit);
    const load = useStudio((s) => s.load);
    const revision = useStudio((s) => s.revision);
    const undo = useStudio((s) => s.undo);
    const redo = useStudio((s) => s.redo);
    const past = useStudio((s) => s.past);
    const future = useStudio((s) => s.future);
    const theme = useThemeStore((s) => s.theme);
    const setTheme = useThemeStore((s) => s.setTheme);
    const t = canvasThemes[theme];
    const [ready, setReady] = useState(false);
    const toolTasks = useToolTasks(p.id, ready);
    const cloudTasks = useQueuedTasks<GenerationJob>(p.id, ready, "generation");
    const legacyGenerations = p.jobs.filter(job => !cloudTasks.jobs.some(task => task.id === job.id));
    const autoCollect = useRef(new Set<string>());
    const [toolPreview, setToolPreview] = useState<ToolJob>();
    const [toolPreviewVersion, setToolPreviewVersion] = useState(0);
    const [workspace, setWorkspace] = useState<"prompt" | "compose" | "assets" | "canvas">("compose");
    const [toolsOpen, setToolsOpen] = useState(false);
    const [saveStatus, setSaveStatus] = useState("正在载入");
    const [saveError, setSaveError] = useState("");
    const [toast, setToast] = useState("");
    const [modal, setModal] = useState<"settings" | "projects" | "analysis" | "jobs" | "about" | null>(null);
    const [projectList, setProjects] = useState<ProjectItem[]>([]);
    const [location, setLocation] = useState("");
    const [config, setConfig] = useState<ConnectionConfig>();
    const canvasProjects = useCanvasStore((s) => s.projects);
    const [canvasSelection, setCanvasSelection] = useState<{ projectId: string; id: string }>();
    const [canvasVisited, setCanvasVisited] = useState(false);
    const linkedCanvases = canvasProjects.filter((c) => p.canvasProjectIds?.includes(c.id));
    const canvasTasks = linkedCanvases.flatMap(c => c.nodes.filter(isCanvasTask).filter(n => !cloudTasks.jobs.some(j => j.canvasProjectId === c.id && j.sourceNodeId === n.id)).map(n => ({ id: n.id, projectId: c.id, name: n.title, status: n.metadata!.status!, error: n.metadata?.errorDetails })));
    const canvasId = (canvasSelection?.projectId === p.id && linkedCanvases.some((c) => c.id === canvasSelection.id) ? canvasSelection.id : linkedCanvases[0]?.id) || "";
    const canvasBusy = linkedCanvases.some((c) => c.nodes.some((n) => n.metadata?.status === "loading" || n.metadata?.status === "stopping"));
    useEffect(() => {
        if (workspace === "canvas") setCanvasVisited(true);
    }, [workspace]);
    useEffect(() => {
        if (config) applySharedConnection(config);
    }, [config]);
    useEffect(() => {
        const open = () => setModal("settings");
        window.addEventListener("studio:settings", open);
        return () => window.removeEventListener("studio:settings", open);
    }, []);
    const [busy, setBusy] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [analysisId, setAnalysisId] = useState("");
    const [analysis, setAnalysis] = useState("");
    const [libraryVisible, setLibraryVisible] = useState(true);
    const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    const savedRevision = useRef(-1);
    const init = useRef(false);
    const saveQueue = useRef(Promise.resolve());
    const notify = useCallback((text: string) => setToast(text), []);
    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(""), 6500);
        return () => clearTimeout(timer);
    }, [toast]);
    useEffect(() => {
        if (modal) dialog.current?.showModal();
        else dialog.current?.close();
    }, [modal]);
    useEffect(() => {
        if (init.current) return;
        init.current = true;
        document.title = "图构 Studio · 模块化视觉创作";
        (async () => {
            try {
                const [result, c] = await Promise.all([studioRequest<{ projects: ProjectItem[]; location: string }>("list"), studioRequest<ConnectionConfig>("config")]);
                setLocation(result.location);
                setConfig(c);
                const recent = result.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                load(recent ? recoverProject(await studioRequest<StudioProject>("open", { id: recent.id, lazy: true })) : await demoProject());
            } catch (e) {
                setSaveError(e instanceof Error ? e.message : "载入失败");
                load(blankProject());
            } finally {
                setReady(true);
            }
        })();
    }, []);
    const save = (project = useStudio.getState().project, version = useStudio.getState().revision) => {
        setSaveStatus("保存中…");
        const task = saveQueue.current
            .catch(() => {})
            .then(async () => {
                if (useCanvasStore.persist.hasHydrated()) await flushCanvasProjects();
                await studioRequest("save", project);
                savedRevision.current = version;
                setSaveStatus("已保存到本机");
                setSaveError("");
            });
        saveQueue.current = task;
        return task.catch((e) => {
            setSaveStatus("保存失败");
            setSaveError(e.message);
            throw e;
        });
    };
    useEffect(() => {
        if (!ready) return;
        setSaveStatus("待保存");
        const timer = setTimeout(() => {
            void save(p, revision).catch(() => {});
        }, 900);
        return () => clearTimeout(timer);
    }, [revision, ready]);
    useEffect(() => {
        const beforeUnload = (e: BeforeUnloadEvent) => {
            if (savedRevision.current !== useStudio.getState().revision || busy || canvasBusy) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        const keys = (e: KeyboardEvent) => {
            if ((workspace === "canvas" || canvasBusy || modal) && e.key.toLowerCase() !== "s") return;
            const editable = (e.target as HTMLElement).closest("input,textarea,select,[contenteditable]");
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void save().catch((e) => notify(e.message));
            } else if (!editable && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
                e.preventDefault();
                e.shiftKey ? redo() : undo();
            } else if (!editable && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener("beforeunload", beforeUnload);
        window.addEventListener("keydown", keys);
        return () => {
            window.removeEventListener("beforeunload", beforeUnload);
            window.removeEventListener("keydown", keys);
        };
    }, [busy, canvasBusy, workspace, modal]);
    const openProjects = async () => {
        try {
            await save();
            const result = await studioRequest<{ projects: ProjectItem[]; location: string }>("list");
            setProjects(result.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
            setModal("projects");
        } catch (e) {
            notify((e as Error).message);
        }
    };
    const collectCloud = (job: GenerationJob, reveal = true) => {
        edit(project => collectGeneration(project, job));
        if (reveal) { setWorkspace("assets"); setToolsOpen(false); }
        notify("生成结果已进入素材库");
    };
    useEffect(() => {
        for (const job of cloudTasks.jobs) if (autoCollect.current.has(job.id) && !["queued", "running"].includes(job.status)) {
            autoCollect.current.delete(job.id);
            try { if (job.status === "completed") collectCloud(job, workspace === "prompt" && !toolsOpen && !modal); else notify(job.error || "生成已停止"); }
            catch (e) { notify((e as Error).message); }
        }
    }, [cloudTasks.jobs]);
    const generate = async (recipe: Recipe) => {
        if (p.assets.length >= 500) { notify("单个工程最多容纳 500 份素材，请新建工程后生成"); return; }
        if (!config?.model) {
            setModal("settings");
            notify("请先配置模型 API 与生成模型");
            return;
        }
        const id = uid();
        const projectId = p.id;
        setBusy(true);
        try {
            await save();
            autoCollect.current.add(id);
            const job = await studioRequest<GenerationJob>("generation-submit", {
                id, projectId, recipeId: recipe.id, fingerprint: recipeFingerprint(p, recipe),
                prompt: buildPrompt(p, recipe), name: recipe.name, size: recipe.size,
                references: uniqueReferences(recipe.references).map((r) => {
                    const asset = p.assets.find((a) => a.id === r.assetId);
                    if (!asset) throw new Error("参考素材已删除，请重新选择");
                    return asset.dataUrl;
                }),
            });
            cloudTasks.upsert(job);
            notify("已加入生成队列，可在任务记录中查看或停止等待");
        } catch (e) {
            notify(`${(e as Error).message}；请先查看任务记录，避免重复提交`);
        } finally {
            setBusy(false);
        }
    };
    const openCanvas = async (recipe: Recipe) => {
        if (canvasBusy) {
            notify("画布正在生成，完成后可载入其他配方");
            return;
        }
        try {
            await save();
            const { sendToCanvas } = await import("./canvas-bridge");
            const id = await sendToCanvas(recipe);
            setCanvasSelection({ projectId: p.id, id });
            setWorkspace("canvas");
            notify("配方和参考图已发送到无限画布；不会自动生成");
        } catch (e) {
            notify((e as Error).message);
        }
    };
    const analyze = async () => {
        const asset = p.assets.find((a) => a.id === analysisId);
        if (!asset) return;
        setAnalyzing(true);
        try {
            const result = await studioRequest<AnalysisResult>("analyze", { image: asset.dataUrl });
            setAnalysis(JSON.stringify(result, null, 2));
        } catch (e) {
            notify((e as Error).message);
        } finally {
            setAnalyzing(false);
        }
    };
    const applyAnalysis = () => {
        try {
            const result = JSON.parse(analysis) as AnalysisResult;
            const modules: PromptModule[] = result.modules.map((m) => ({ id: uid(), name: m.name, kind: m.kind, text: m.text, global: m.kind === "style" }));
            const recipes: Recipe[] = result.recipes.map((r) => ({
                id: uid(),
                name: r.name,
                moduleIds: r.moduleNames.map((name) => modules.find((m) => m.name === name)?.id).filter((id): id is string => !!id),
                references: [],
                output: r.output,
                size: "1024x1536",
            }));
            const next = { ...p, modules, recipes };
            validateProject(next);
            edit(() => next);
            setModal(null);
            setWorkspace("prompt");
            notify("已载入分析模块。素材与图层保持不变。");
        } catch (e) {
            notify(`分析格式无效：${(e as Error).message}`);
        }
    };
    const style = {
        "--studio-bg": t.canvas.background,
        "--studio-panel": t.node.panel,
        "--studio-fill": t.node.fill,
        "--studio-line": t.node.stroke,
        "--studio-text": t.node.text,
        "--studio-muted": t.node.muted,
        "--studio-faint": t.node.faint,
        "--studio-accent": t.accent,
        "--studio-accent-fill": theme === "dark" ? "#293247" : "#e8edff",
    } as React.CSSProperties;
    return (
        <StudioTheme>
            <div className="studio" style={style}>
                <header className={`${windowStyles.titlebar} studio-ui relative flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-[var(--studio-line)] bg-[var(--studio-panel)] px-5 py-2`}>
                    <Button type="text" aria-label="关于图构" icon={<Layers3 size={23} />} onClick={() => setModal("about")}>
                        <span className="text-lg font-semibold tracking-tight">图构</span>
                    </Button>
                    <Button type="text" className="max-w-56 max-[1100px]:max-w-36" disabled={busy || canvasBusy} onClick={openProjects}>
                        <span className="truncate">{p.name}</span>
                        <ChevronDown size={13} />
                    </Button>
                    <nav aria-label="工作区" className="ml-3 flex items-center gap-1 max-[900px]:order-last max-[900px]:w-full">
                        {(
                            [
                                ["prompt", "提示词工作台", Shapes],
                                ["canvas", "无限画布", ScanLine],
                                ["compose", "图层合成", Layers3],
                                ["assets", "素材库", Images],
                            ] as const
                        ).map(([id, label, Icon]) => (
                            <Button
                                key={id}
                                type="text"
                                aria-current={!toolsOpen && workspace === id ? "page" : undefined}
                                onClick={() => { setToolsOpen(false); setWorkspace(id); }}
                                icon={<Icon size={16} />}
                                style={!toolsOpen && workspace === id ? { background: "var(--studio-accent-fill)", color: "var(--studio-accent)" } : { color: "var(--studio-muted)" }}
                            >
                                {label}
                            </Button>
                        ))}
                    </nav>
                    <div className="ml-auto flex items-center gap-1">
                        <Button type="text" aria-pressed={toolsOpen} style={toolsOpen ? { background: "var(--studio-accent-fill)", color: "var(--studio-accent)" } : undefined} onClick={() => setToolsOpen(v => !v)}>图片工具</Button>
                        {workspace !== "canvas" && (
                            <>
                                <IconButton label="撤销 Ctrl+Z" disabled={!past.length || busy || canvasBusy} onClick={undo}>
                                    <Undo2 size={16} />
                                </IconButton>
                                <IconButton label="重做 Ctrl+Shift+Z" disabled={!future.length || busy || canvasBusy} onClick={redo}>
                                    <Redo2 size={16} />
                                </IconButton>
                            </>
                        )}
                        <IconButton label="连接设置" onClick={() => setModal("settings")}>
                            <Settings2 size={17} />
                        </IconButton>
                        <IconButton label="切换主题" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
                        </IconButton>
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    {
                                        key: "save",
                                        label: "保存工程",
                                        icon: <Save size={15} />,
                                        onClick: () =>
                                            void save()
                                                .then(() => notify("已保存"))
                                                .catch((e) => notify(e.message)),
                                    },
                                    {
                                        key: "analysis",
                                        label: "分析参考图",
                                        icon: <ScanLine size={15} />,
                                        onClick: () => {
                                            setAnalysisId(p.assets[0]?.id || "");
                                            setModal("analysis");
                                        },
                                    },
                                    {
                                        key: "collect",
                                        label: "收集画布结果",
                                        icon: <RefreshCw size={15} />,
                                        onClick: async () => {
                                            try {
                                                const { importCanvasImages } = await import("./canvas-bridge");
                                                const count = await importCanvasImages();
                                                notify(count ? `已入库 ${count} 张图片` : "没有新图片");
                                            } catch (e) {
                                                notify((e as Error).message);
                                            }
                                        },
                                    },
                                    {
                                        key: "export",
                                        label: "导出工程",
                                        icon: <Download size={15} />,
                                        onClick: () =>
                                            void exportProject(p)
                                                .then((r) => notify(`已导出：${r.path}`))
                                                .catch((e) => notify(e.message)),
                                    },
                                ],
                            }}
                        >
                            <Button type="text" aria-label="更多操作" icon={<MoreHorizontal size={19} />} />
                        </Dropdown>
                    </div>
                    <WindowControls />
                </header>
                {saveError && (
                    <div className="error-banner" role="alert">
                        本机保存遇到问题：{saveError}
                        <button onClick={() => void save().catch((e) => notify(e.message))}>重试保存</button>
                        <button
                            onClick={() =>
                                void exportProject(p)
                                    .then((r) => notify(`工程已导出：${r.path}`))
                                    .catch((e) => notify(e.message))
                            }
                        >
                            下载工程备份
                        </button>
                    </div>
                )}
                {!ready ? (
                    <div className="empty-state loading">正在打开工作台与本地素材…</div>
                ) : toolsOpen ? <ImageToolPanel key={`${p.id}:${toolPreviewVersion}`} notify={notify} tasks={toolTasks} cloudTasks={cloudTasks} initialJob={toolPreview?.projectId === p.id ? toolPreview : undefined} /> : workspace === "canvas" ? null : workspace === "prompt" ? (
                    <PromptWorkspace
                        key={p.id}
                        generate={generate}
                        openCanvas={openCanvas}
                        busy={busy}
                        notify={notify}
                        analyze={() => {
                            setAnalysisId(p.assets[0]?.id || "");
                            setModal("analysis");
                        }}
                    />
                ) : workspace === "assets" ? (
                    <AssetLibrary notify={notify} onCompose={() => setWorkspace("compose")} />
                ) : (
                    <div className={`compose-workspace ${!libraryVisible ? "hide-library" : ""}`}>
                        <div className="compose-toolbar" ref={setToolbarHost} />
                        <aside className="compose-assets">{libraryVisible && <AssetLibrary compact notify={notify} onCompose={() => setWorkspace("compose")} />}</aside>
                        <main className="compose-main">
                            <Editor notify={notify} toolbarHost={toolbarHost} libraryVisible={libraryVisible} toggleLibrary={() => setLibraryVisible(!libraryVisible)} />
                        </main>
                        <aside className="compose-properties">
                            <LayerPanel notify={notify} />
                            <Inspector notify={notify} />
                        </aside>
                    </div>
                )}
                {ready && canvasVisited && (
                    <section className="canvas-workspace" hidden={toolsOpen || workspace !== "canvas"} aria-label="无限画布工作区" inert={toolsOpen || workspace !== "canvas"}>
                        <div className="studio-ui canvas-workspace-bar">
                            <Select aria-label="当前工程画布" disabled={canvasBusy} value={canvasId || undefined} placeholder="当前工程还没有画布"
                                className="w-80 max-w-[50%]" variant="borderless"
                                options={linkedCanvases.map((c) => ({ value: c.id, label: c.title }))}
                                onChange={(id) => setCanvasSelection({ projectId: p.id, id })} />
                            <Button type="text" icon={<FilePlus2 size={15} />}
                                disabled={canvasBusy}
                                onClick={() => {
                                    const id = useCanvasStore.getState().createProject(`${p.name} · 画布 ${linkedCanvases.length + 1}`);
                                    edit((p) => ({ ...p, canvasProjectIds: [...(p.canvasProjectIds || []), id] }));
                                    setCanvasSelection({ projectId: p.id, id });
                                }}
                            >
                                新建画布
                            </Button>
                            <span className="hint">{canvasBusy ? "生成中…" : ""}</span>
                        </div>
                        <div className="integrated-canvas">{canvasId ? <CanvasWorkspace key={canvasId} projectId={canvasId} embedded /> : <div className="empty-state">新建画布，或从提示词工作台发送配方。</div>}</div>
                    </section>
                )}
                <footer className="studio-ui flex h-9 shrink-0 items-center justify-between border-t border-[var(--studio-line)] bg-[var(--studio-panel)] px-5 text-xs text-[var(--studio-muted)]">
                    <span title={location} role="status" className={saveError ? "text-[var(--studio-danger)]" : ""}>
                        {saveStatus === "已保存到本机" ? "已保存" : saveStatus}
                    </span>
                    <div className="flex items-center gap-3">
                        <Button type="text" size="small" onClick={() => setModal("jobs")} icon={<Clock3 size={13} />}>
                            {busy || canvasBusy || [...toolTasks.jobs, ...cloudTasks.jobs].some(j => ["queued", "running"].includes(j.status)) ? "处理中" : "任务"}
                            {legacyGenerations.length + toolTasks.jobs.length + canvasTasks.length + cloudTasks.jobs.length ? ` · ${legacyGenerations.length + toolTasks.jobs.length + canvasTasks.length + cloudTasks.jobs.length}` : ""}
                        </Button>
                        <Button type="text" size="small" onClick={() => setModal("settings")}>
                            {config?.model || "连接模型"}
                        </Button>
                    </div>
                </footer>
                <input
                    ref={input}
                    type="file"
                    accept=".studio,.json"
                    hidden
                    onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                            if (file.size > MAX_PROJECT_BYTES) throw new Error("工程超过 512 MB 限制");
                            const imported = recoverProject(JSON.parse(await file.text()));
                            imported.id = uid();
                            await save();
                            await studioRequest("save", imported);
                            load(recoverProject(await studioRequest<StudioProject>("open", { id: imported.id, lazy: true })));
                            setModal(null);
                            notify("已导入工程副本");
                        } catch (e) {
                            notify((e as Error).message);
                        } finally {
                            if (input.current) input.current.value = "";
                        }
                    }}
                />
                <dialog
                    ref={dialog}
                    className="studio-dialog"
                    style={style}
                    onCancel={() => setModal(null)}
                    onClick={(e) => {
                        if (e.target === dialog.current) setModal(null);
                    }}
                >
                    <div className="dialog-heading">
                        <h2>{{ settings: "模型连接", projects: "本机工程", analysis: "分析参考图", jobs: "任务记录", about: "关于图构 Studio" }[modal || "about"]}</h2>
                        <button aria-label="关闭弹窗" onClick={() => setModal(null)}>
                            <X size={19} />
                        </button>
                    </div>
                    <div className="dialog-content">
                        {modal === "settings" && <Settings notify={notify} onSaved={setConfig} />}
                        {modal === "projects" && (
                            <>
                                <div className="inline">
                                    <button
                                        className="primary"
                                        onClick={() => {
                                            load(blankProject());
                                            setWorkspace("prompt");
                                            setModal(null);
                                        }}
                                    >
                                        <FilePlus2 size={16} />
                                        空白工程
                                    </button>
                                    <button onClick={() => input.current?.click()}>
                                        <FolderOpen size={15} />
                                        导入工程
                                    </button>
                                    <button
                                        onClick={async () => {
                                            try {
                                                load(await demoProject());
                                                setModal(null);
                                            } catch (e) {
                                                notify((e as Error).message);
                                            }
                                        }}
                                    >
                                        新建 C 版示例
                                    </button>
                                </div>
                                <div className="project-list">
                                    {projectList.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={async () => {
                                                try {
                                                    load(recoverProject(await studioRequest<StudioProject>("open", { id: item.id, lazy: true })));
                                                    setModal(null);
                                                } catch (e) {
                                                    notify((e as Error).message);
                                                }
                                            }}
                                        >
                                            <FolderOpen size={20} />
                                            <span>
                                                <strong>{item.name}</strong>
                                                <small>
                                                    {new Date(item.updatedAt).toLocaleString("zh-CN")} · {item.layers} 图层
                                                </small>
                                            </span>
                                            <ArrowUpRight size={16} />
                                        </button>
                                    ))}
                                </div>
                                <p className="hint">工程与图片一起保存在：{location}</p>
                                {window.studioDesktop && <button onClick={() => window.studioDesktop?.openFolder()}>打开工程文件夹</button>}
                            </>
                        )}
                        {modal === "analysis" && (
                            <>
                                <p className="hint">先从图片提取提示词，再由你决定组合方式。只有点击分析才会把选中的参考图发送到已配置的视觉模型。</p>
                                <label>
                                    选择要分析的图片
                                    <select
                                        value={analysisId}
                                        onChange={(e) => {
                                            setAnalysisId(e.target.value);
                                            setAnalysis("");
                                        }}
                                    >
                                        <option value="">选择一张素材</option>
                                        {p.assets.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {a.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {analysisId && <img className="analysis-image checker" src={p.assets.find((a) => a.id === analysisId)?.dataUrl} alt="待分析参考图" />}
                                <button className="primary full" disabled={!analysisId || analyzing} onClick={analyze}>
                                    <ScanLine size={16} />
                                    {analyzing ? "正在分析…" : "分析并生成模块提示词"}
                                </button>
                                <details open={!!analysis}>
                                    <summary>查看或粘贴结构化分析结果</summary>
                                    <textarea
                                        className="analysis-json"
                                        aria-label="分析结果 JSON"
                                        value={analysis}
                                        onChange={(e) => setAnalysis(e.target.value)}
                                        placeholder={'{"modules":[{"name":"公共画风","kind":"style","text":"…"}],"recipes":[{"name":"人物","moduleNames":[],"output":"…"}]}'}
                                    />
                                </details>
                                {analysis && (
                                    <button className="secondary full" onClick={applyAnalysis}>
                                        替换提示词与配方（保留素材和图层）
                                    </button>
                                )}
                            </>
                        )}
                        {modal === "jobs" && <TaskOverview tasks={toolTasks} generations={legacyGenerations} cloud={cloudTasks} onCollect={collectCloud} canvas={canvasTasks}
                            onPreview={job => { setToolPreview(job); setToolPreviewVersion(n => n + 1); setToolsOpen(true); setModal(null); }}
                            onCanvas={id => { setCanvasSelection({ projectId: p.id, id }); setToolsOpen(false); setWorkspace("canvas"); setModal(null); }} />}
                        {modal === "about" && (
                            <div className="about">
                                <Layers3 size={34} />
                                <h2>图构 Studio</h2>
                                <p>拆分灵感，生成素材，逐层创作。</p>
                                <p>本地桌面工作台 · 0.1.0</p>
                                <div className="section-line" />
                                <p>
                                    基于{" "}
                                    <a href="https://github.com/tigerowo/infinite-canvas" target="_blank" rel="noreferrer">
                                        tigerowo / infinite-canvas
                                    </a>
                                    （AGPL-3.0）开发，保留原版生成画布和存储能力。
                                </p>
                                <p>
                                    图层结构参考{" "}
                                    <a href="https://github.com/robbietilton/Compositor" target="_blank" rel="noreferrer">
                                        Wonder Assembly / Compositor
                                    </a>
                                    （MIT）。Windows 渲染使用 Konva，当前支持图像、文字、分组、基础混合与矩形蒙版。
                                </p>
                                <p className="hint">当前不提供 PSD、CMYK 或 Compositor 原生工程兼容。附带的 C 版素材仅用于你的本地创作。</p>
                            </div>
                        )}
                    </div>
                </dialog>
                {toast && (
                    <div className="studio-toast" role="status">
                        <AlertCircle size={17} />
                        <span>{toast}</span>
                        <button aria-label="关闭提示" onClick={() => setToast("")}>
                            <X size={14} />
                        </button>
                    </div>
                )}
            </div>
        </StudioTheme>
    );
}
