import { useCallback, useEffect, useRef, useState } from "react";
import { watchOutreach } from "../lib/outreach";

type Tables = Parameters<typeof watchOutreach>[1];

export function useOutreachSnapshot<T>(ownerId: string, tables: Tables, load: () => Promise<T>) {
  const [snapshot, setSnapshot] = useState<T>();
  const [error, setError] = useState("");
  const [live, setLive] = useState<boolean>();
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let active = true;
    let sequence = 0;

    async function refresh() {
      if (!active) return;
      const request = ++sequence;
      try {
        const data = await load();
        if (active && request === sequence) {
          setSnapshot(data);
          setError("");
        }
      } catch (reason) {
        if (active && request === sequence) setError(reason instanceof Error ? reason.message : "Try again in a moment.");
      }
    }

    refreshRef.current = refresh;
    const unsubscribe = watchOutreach(ownerId, tables, refresh, (connected) => { if (active) setLive(connected); });
    void refresh();
    return () => { active = false; unsubscribe(); };
  }, [ownerId, tables, load]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { snapshot, error, live, refresh };
}
