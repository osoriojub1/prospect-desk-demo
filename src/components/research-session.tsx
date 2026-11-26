"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { readSystemLogs, readUnreadReplies, type SystemLog } from "../lib/outreach";
import { researchClient, researchConfigured } from "../lib/research";
import { useOutreachSnapshot } from "./use-outreach-snapshot";

const ResearchSession = createContext<{ session: Session | null; loading: boolean }>({ session: null, loading: false });
const WorkspaceEvents = createContext<{
  events?: SystemLog[];
  unreadEvents?: number;
  unreadReplies?: number;
  error: string;
  refreshLogs: () => Promise<void>;
  refreshReplies: () => Promise<void>;
}>({
  error: "",
  refreshLogs: async () => {},
  refreshReplies: async () => {},
});
const logTables = ["system_log_events"] as const;
const replyTables = ["outreach_replies"] as const;

export function ResearchSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(researchConfigured);
  const ownerId = session?.user.is_anonymous ? undefined : session?.user.id;

  useEffect(() => {
    if (!researchConfigured) return;
    const { data: { subscription } } = researchClient().auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  return <ResearchSession.Provider value={{ session, loading }}>
    {ownerId ? <WorkspaceEventProvider key={ownerId} ownerId={ownerId}>{children}</WorkspaceEventProvider> : children}
  </ResearchSession.Provider>;
}

function WorkspaceEventProvider({ children, ownerId }: { children: ReactNode; ownerId: string }) {
  const logs = useOutreachSnapshot(ownerId, logTables, readSystemLogs);
  const replies = useOutreachSnapshot(ownerId, replyTables, readUnreadReplies);

  return <WorkspaceEvents.Provider value={{
    events: logs.snapshot?.events,
    unreadEvents: logs.snapshot?.unread,
    unreadReplies: replies.snapshot,
    error: logs.error,
    refreshLogs: logs.refresh,
    refreshReplies: replies.refresh,
  }}>{children}</WorkspaceEvents.Provider>;
}

export function useResearchSession() {
  return useContext(ResearchSession);
}

export function useWorkspaceEvents() {
  return useContext(WorkspaceEvents);
}

