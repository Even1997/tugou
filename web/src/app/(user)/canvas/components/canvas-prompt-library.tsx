"use client";

import { useState } from "react";
import { Button, Modal, Tooltip } from "antd";
import { BookOpen } from "lucide-react";

import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasModules } from "@/app/studio/canvas-modules";

export function CanvasPromptLibrary({ embedded = false, onSelect }: { embedded?: boolean; onSelect: (prompt: string) => void }) {
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <Tooltip title="提示词库">
                <Button
                    type="text"
                    className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                    style={{ color: theme.node.text }}
                    icon={<BookOpen className="size-3.5" />}
                    onClick={() => setOpen(true)}
                    aria-label="提示词库"
                />
            </Tooltip>
            {embedded ? <Modal title="提示词模块" open={open} onCancel={() => setOpen(false)} footer={null} width={560} destroyOnHidden>
                <div className="h-[480px]"><CanvasModules onInsert={(payload) => { onSelect(payload.content); setOpen(false); }} /></div>
            </Modal> : <PromptSelectDialog open={open} onOpenChange={setOpen} onSelect={onSelect} />}
        </>
    );
}
