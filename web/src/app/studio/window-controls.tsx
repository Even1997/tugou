"use client";
import { useEffect, useState } from "react";
import { App, Button, Tooltip } from "antd";
import { Copy, Minus, Square, X } from "lucide-react";
import styles from "./window-controls.module.css";

const buttonClass = "!h-16 !w-11 !rounded-none !p-0";

export function WindowControls() {
    const [desktop, setDesktop] = useState(false);
    const [maximized, setMaximized] = useState(false);
    const { message } = App.useApp();
    useEffect(() => {
        const api = window.studioDesktop;
        if (!api?.windowAction || !api.windowState || !api.onWindowState) return;
        setDesktop(true);
        let active = true;
        const update = (state: { maximized: boolean }) => { if (active) setMaximized(state.maximized); };
        const unsubscribe = api.onWindowState(update);
        void api.windowState().then(update).catch(() => {});
        return () => { active = false; unsubscribe(); };
    }, []);
    if (!desktop) return null;
    const act = (action: "minimize" | "toggle-maximize" | "close") => {
        void window.studioDesktop?.windowAction?.(action).catch(() => message.error("窗口操作失败，请重试"));
    };
    return (
        <div className={styles.controls} role="group" aria-label="窗口控制">
            <Tooltip title="最小化"><Button type="text" className={buttonClass} aria-label="最小化窗口" onClick={() => act("minimize")} icon={<Minus size={15} />} /></Tooltip>
            <Tooltip title={maximized ? "还原" : "最大化"}><Button type="text" className={buttonClass} aria-label={maximized ? "还原窗口" : "最大化窗口"} onClick={() => act("toggle-maximize")} icon={maximized ? <Copy size={13} /> : <Square size={12} />} /></Tooltip>
            <Tooltip title="关闭"><Button type="text" className={`${buttonClass} ${styles.close}`} aria-label="关闭窗口" onClick={() => act("close")} icon={<X size={17} />} /></Tooltip>
        </div>
    );
}
