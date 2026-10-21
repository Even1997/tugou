import { create } from "zustand";
import { blankProject, now, type StudioProject } from "./model";
import { trimHistory } from "./editor-history";
import { normalizeGroupFrames } from "./layer-operations";

type State = {
    project: StudioProject;
    selected: string[];
    past: StudioProject[];
    future: StudioProject[];
    revision: number;
    lastEdit?: { key: string; time: number };
    edit: (fn: (p: StudioProject) => StudioProject, mergeKey?: string) => void;
    load: (p: StudioProject) => void;
    select: (ids: string[]) => void;
    undo: () => void;
    redo: () => void;
};
export const useStudio = create<State>((set) => ({
    project: blankProject(),
    selected: [],
    past: [],
    future: [],
    revision: 0,
    edit: (fn, mergeKey) =>
        set((s) => {
            let p = fn(s.project);
            if (p === s.project) return s;
            if (p.layers !== s.project.layers) p = { ...p, layers: normalizeGroupFrames(p.layers) };
            const merged = mergeKey && s.lastEdit?.key === mergeKey && Date.now() - s.lastEdit.time < 800;
            return { project: { ...p, updatedAt: now() }, past: trimHistory(merged ? s.past : [...s.past, s.project], p), future: [], revision: s.revision + 1, lastEdit: mergeKey ? { key: mergeKey, time: Date.now() } : undefined };
        }),
    load: (project) => set((s) => ({ project, selected: [], past: [], future: [], revision: s.revision + 1, lastEdit: undefined })),
    select: (selected) => set({ selected, lastEdit: undefined }),
    undo: () => set((s) => (s.past.length ? { project: { ...s.past.at(-1)!, updatedAt: now() }, past: s.past.slice(0, -1), future: [s.project, ...s.future], selected: [], revision: s.revision + 1, lastEdit: undefined } : s)),
    redo: () => set((s) => (s.future.length ? { project: { ...s.future[0], updatedAt: now() }, past: trimHistory([...s.past, s.project], s.future[0]), future: s.future.slice(1), selected: [], revision: s.revision + 1, lastEdit: undefined } : s)),
}));
