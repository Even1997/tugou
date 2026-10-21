export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        accent: "#536acc",
        canvas: {
            background: "#f3f5fa",
            dot: "rgba(68,64,60,.28)",
            line: "rgba(68,64,60,.12)",
            selectionStroke: "#536acc",
            selectionFill: "rgba(28,25,23,.06)",
        },
        node: {
            label: "#526078",
            fill: "#e9edf5",
            panel: "#ffffff",
            stroke: "#dce1ed",
            activeStroke: "#536acc",
            placeholder: "#647189",
            text: "#252b38",
            muted: "#647189",
            faint: "#8894a8",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#dce1ed",
            item: "#526078",
            itemHover: "#e9edf5",
            activeBg: "#e9edf5",
            activeText: "#252b38",
        },
    },
    dark: {
        accent: "#b1c0ff",
        canvas: {
            background: "#15171d",
            dot: "rgba(245,245,244,.24)",
            line: "rgba(245,245,244,.10)",
            selectionStroke: "#b1c0ff",
            selectionFill: "rgba(250,250,249,.10)",
        },
        node: {
            label: "#aeb9cb",
            fill: "#252b38",
            panel: "#1d2028",
            stroke: "#343b49",
            activeStroke: "#b1c0ff",
            placeholder: "#8894a8",
            text: "#e8ecf4",
            muted: "#aeb9cb",
            faint: "#738198",
        },
        toolbar: {
            panel: "rgba(29,32,40,.96)",
            border: "#343b49",
            item: "#aeb9cb",
            itemHover: "#252b38",
            activeBg: "#323b50",
            activeText: "#e8ecf4",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
