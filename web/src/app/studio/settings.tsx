"use client";
import { useEffect, useState } from "react";
import { Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { studioRequest } from "./client-api";
import { AutoComplete, Button, Input } from "antd";
import { Field } from "./ui";

export type ConnectionConfig = { baseUrl: string; model: string; analysisModel: string; hasApiKey: boolean };
declare global {
    interface Window {
        studioDesktop?: {
            saveConnection: (settings: Record<string, unknown>) => Promise<void>;
            openFolder: () => Promise<void>;
            version: string;
            windowAction?: (action: "minimize" | "toggle-maximize" | "close") => Promise<void>;
            windowState?: () => Promise<{ maximized: boolean }>;
            onWindowState?: (callback: (state: { maximized: boolean }) => void) => () => void;
        };
    }
}
export function Settings({ notify, onSaved }: { notify: (text: string) => void; onSaved: (c: ConnectionConfig) => void }) {
    const [c, setConfig] = useState<ConnectionConfig>();
    const [key, setKey] = useState("");
    const [models, setModels] = useState<{ model: string }[]>([]);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        studioRequest<ConnectionConfig>("config")
            .then(setConfig)
            .catch((e) => notify(e.message));
    }, []);
    if (!c) return <p>正在读取连接设置…</p>;
    const save = async () => {
        const settings = { ...c, ...(key ? { apiKey: key } : {}) };
        const result = await studioRequest<ConnectionConfig>("configure", settings);
        await window.studioDesktop?.saveConnection(settings);
        setConfig(result);
        onSaved(result);
        setKey("");
        return result;
    };
    const patch = (values: Partial<ConnectionConfig>) => setConfig({ ...c, ...values });
    return (
        <div className="studio-ui flex flex-col gap-5">
            <p className="text-sm text-[var(--studio-muted)]">所有工作区共用此连接。</p>
            <Field label="API 地址">
                <Input aria-label="API 地址" value={c.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="https://.../v1" />
            </Field>
            <Field label="API 密钥" hint={c.hasApiKey ? "已配置，留空保持" : "未配置"}>
                <Input.Password aria-label="API 密钥" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            <Field label="生成模型">
                <AutoComplete aria-label="生成模型" getPopupContainer={(trigger) => trigger.parentElement!} value={c.model} onChange={(model) => patch({ model })} options={models.map((m) => ({ value: m.model }))} placeholder="输入或选择模型" />
            </Field>
            <Field label="分析模型" hint="可选">
                <Input aria-label="分析模型" value={c.analysisModel} onChange={(e) => patch({ analysisModel: e.target.value })} placeholder="支持图片理解的模型" />
            </Field>
            <div className="flex flex-wrap justify-end gap-3 pt-2">
                <Button
                    loading={busy}
                    icon={<RefreshCw size={15} />}
                    onClick={async () => {
                        setBusy(true);
                        try {
                            await save();
                            const result = await studioRequest<{ models?: { model: string }[] }>("models");
                            setModels(result.models || []);
                            notify(`连接成功，读取到 ${result.models?.length || 0} 个模型`);
                        } catch (e) {
                            notify(e instanceof Error ? e.message : "连接失败");
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    保存并读取模型
                </Button>
                <Button
                    disabled={busy}
                    type="primary"
                    icon={<Plug size={15} />}
                    onClick={async () => {
                        setBusy(true);
                        try {
                            await save();
                            notify("连接已保存");
                        } catch (e) {
                            notify(e instanceof Error ? e.message : "保存失败");
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    保存连接
                </Button>
            </div>
            <p className="flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                <ShieldCheck size={15} />
                {window.studioDesktop ? "桌面版使用 Windows 加密保存密钥，工程文件不包含密钥。" : "浏览器预览的密钥仅保留在本次服务进程中；重启后需重新填写。"}
            </p>
        </div>
    );
}
