"use client";
import type { ReactNode } from "react";
import { Button, ConfigProvider, Tooltip, type ButtonProps } from "antd";
import { Palette, UserRound, Move, Shirt, Trees, Sparkles, Shapes } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function StudioTheme({ children }: { children: ReactNode }) {
    const mode = useThemeStore((s) => s.theme);
    const t = canvasThemes[mode];
    return (
        <ConfigProvider
            theme={{
                token: {
                    colorPrimary: t.accent,
                    colorInfo: t.accent,
                    colorText: t.node.text,
                    colorTextSecondary: t.node.muted,
                    colorBgContainer: t.node.panel,
                    colorBgElevated: t.node.panel,
                    colorBorder: t.node.stroke,
                    colorFillSecondary: t.node.fill,
                    borderRadius: 8,
                    controlHeight: 36,
                    fontSize: 14,
                    fontFamily: '"Segoe UI Variable", "Microsoft YaHei UI", sans-serif',
                    colorTextLightSolid: mode === "dark" ? t.canvas.background : "#ffffff",
                },
                components: { Button: { primaryShadow: "none", defaultShadow: "none" }, Input: { activeShadow: "none" } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function IconButton({ label, children, ...props }: ButtonProps & { label: string }) {
    return (
        <Tooltip title={label}>
            <Button type="text" aria-label={label} icon={children} {...props} />
        </Tooltip>
    );
}

export function PanelHeader({ title, count, actions }: { title: string; count?: number; actions?: ReactNode }) {
    return (
        <div className="flex h-16 shrink-0 items-center gap-2 px-5">
            <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold">{title}</h2>
            {count !== undefined && <span className="text-xs tabular-nums text-[var(--studio-muted)]">{count}</span>}
            <div className="ml-auto flex items-center gap-1">{actions}</div>
        </div>
    );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--studio-muted)]">
                <span>{label}</span>
                {hint}
            </div>
            {children}
        </div>
    );
}

export function ModuleMark({ kind }: { kind: string }) {
    const Icon = ({ style: Palette, 人物: UserRound, 动作: Move, 服饰: Shirt, 背景: Trees, 装饰: Sparkles } as Record<string, typeof Shapes>)[kind] || Shapes;
    return (
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${kind === "style" ? "bg-[var(--studio-accent-fill)] text-[var(--studio-accent)]" : "bg-[var(--studio-fill)] text-[var(--studio-muted)]"}`}>
            <Icon size={16} />
        </span>
    );
}
