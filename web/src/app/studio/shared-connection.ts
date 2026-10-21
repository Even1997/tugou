import { defaultConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import type { ConnectionConfig } from "./settings";

// Only public metadata enters the renderer. The real key stays in the local gateway.
export function applySharedConnection(c: ConnectionConfig) {
    const id = "studio-shared";
    const baseUrl = `${window.location.origin}/api/studio/model/v1`;
    const apiKey = c.hasApiKey ? "studio-managed" : "";
    const models = Array.from(new Set([c.model, c.analysisModel].filter(Boolean)));
    const config: AiConfig = {
        ...defaultConfig, channelMode: "local", baseUrl, apiKey,
        model: c.analysisModel, imageModel: c.model, textModel: c.analysisModel,
        videoModel: "", audioModel: "", models,
        imageModels: c.model ? [c.model] : [], textModels: c.analysisModel ? [c.analysisModel] : [],
        activeChannelId: id, imageChannelId: id, textChannelId: id,
        localChannels: [{ id, protocol: "openai", name: "Studio 共用连接", baseUrl, apiKey, models,
            modelCapabilities: { ...(c.model ? { [c.model]: "image" as const } : {}), ...(c.analysisModel ? { [c.analysisModel]: "text" as const } : {}) } }],
    };
    useConfigStore.setState({ studioConfig: config });
}
