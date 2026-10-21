import type { Metadata } from "next";
export const metadata: Metadata = { title: "图构 Studio · 模块化视觉创作", description: "提示词模块、素材生成与图层合成桌面工作台" };
export default function StudioLayout({ children }: { children: React.ReactNode }) {
    return children;
}
