"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { studioRequest } from "./client-api";
import { uid } from "./model";
import type { ToolJob } from "./tool-schema";

export function useQueuedTasks<T extends { id: string; projectId: string; status: string }>(projectId: string, enabled: boolean, prefix: "tool" | "generation") {
    const [jobs, setJobs] = useState<T[]>([]), [error, setError] = useState("");
    const current = useRef(projectId), retryIds = useRef(new Map<string, string>());
    const changes = useRef(0);
    const upsert = useCallback((job: T) => {
        if (current.current === job.projectId) { changes.current++; setJobs(rows => [job, ...rows.filter(row => row.id !== job.id)]); }
    }, []);
    useEffect(() => {
        current.current = projectId; setJobs([]); setError(""); retryIds.current.clear();
        let stopped = false, timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            let delay = 5000;
            const revision = changes.current;
            try {
                const rows = await studioRequest<T[]>(`${prefix}-list`, { projectId });
                if (!stopped && revision === changes.current) { setJobs(rows); setError(""); }
                if (rows.some(j => ["running", "queued"].includes(j.status))) delay = 1500;
            } catch (e) { if (!stopped) setError((e as Error).message); }
            finally { if (!stopped) timer = setTimeout(poll, delay); }
        };
        if (enabled) void poll();
        return () => { stopped = true; current.current = ""; clearTimeout(timer); };
    }, [projectId, enabled, prefix]);
    const cancel = async (job: T) => { upsert(await studioRequest<T>(`${prefix}-cancel`, { id: job.id, projectId: job.projectId })); };
    const retry = async (job: T) => {
        const newId = retryIds.current.get(job.id) || uid(); retryIds.current.set(job.id, newId);
        upsert(await studioRequest<T>(`${prefix}-retry`, { id: job.id, projectId: job.projectId, newId }));
    };
    return { jobs: jobs.filter(j => j.projectId === projectId), error, upsert, cancel, retry };
}
export function useToolTasks(projectId: string, enabled: boolean) { return useQueuedTasks<ToolJob>(projectId, enabled, "tool"); }
export type ToolTasks = ReturnType<typeof useToolTasks>;
