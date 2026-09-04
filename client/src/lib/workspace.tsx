import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type Tool, type UploadedFile, type Category, type Workflow } from './api';

interface WorkspaceValue {
  files: UploadedFile[];
  tools: Tool[];
  categories: Category[];
  workflows: Workflow[];
  capabilities: { ai: boolean; transcription: boolean };
  loading: boolean;
  recentTools: string[];
  addFiles: (files: UploadedFile[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  markToolUsed: (id: string) => void;
  toolById: (id: string) => Tool | undefined;
  toolByRoute: (route: string) => Tool | undefined;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const RECENT_KEY = 'rw:recent-tools';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [capabilities, setCapabilities] = useState({ ai: false, transcription: false });
  const [loading, setLoading] = useState(true);
  const [recentTools, setRecentTools] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
  });

  useEffect(() => {
    let cancelled = false;
    api.tools()
      .then((data) => {
        if (cancelled) return;
        setTools(data.tools);
        setCategories(data.categories);
        setWorkflows(data.workflows);
        setCapabilities(data.capabilities);
      })
      .catch((err: ApiError) => { if (!cancelled) console.warn('tool registry unavailable', err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const addFiles = useCallback((incoming: UploadedFile[]) => {
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.id));
      return [...prev, ...incoming.filter((f) => !seen.has(f.id))];
    });
  }, []);

  const removeFile = useCallback((id: string) => setFiles((prev) => prev.filter((f) => f.id !== id)), []);
  const clearFiles = useCallback(() => setFiles([]), []);

  const markToolUsed = useCallback((id: string) => {
    setRecentTools((prev) => {
      const next = [id, ...prev.filter((t) => t !== id)].slice(0, 8);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const value = useMemo<WorkspaceValue>(() => ({
    files, tools, categories, workflows, capabilities, loading, recentTools,
    addFiles, removeFile, clearFiles, markToolUsed,
    toolById: (id) => tools.find((t) => t.id === id),
    toolByRoute: (route) => tools.find((t) => t.route === route),
  }), [files, tools, categories, workflows, capabilities, loading, recentTools, addFiles, removeFile, clearFiles, markToolUsed]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
