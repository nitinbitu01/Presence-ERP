// src/lib/useLastUpdated.ts
// ─────────────────────────────────────────────────────────────────────────────
// Tracks when data was last successfully fetched and formats it
// as a human-readable "Updated X minutes ago" string.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";

export function useLastUpdated(dataVersion: unknown) {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [label, setLabel] = useState<string>("");
  const prevVersion = useRef<unknown>(undefined);

  useEffect(() => {
    if (dataVersion !== undefined && dataVersion !== prevVersion.current) {
      prevVersion.current = dataVersion;
      setLastUpdated(new Date());
    }
  }, [dataVersion]);

  useEffect(() => {
    if (!lastUpdated) return;

    const update = () => {
      const diffMs = Date.now() - lastUpdated.getTime();
      const diffS = Math.floor(diffMs / 1000);
      const diffM = Math.floor(diffS / 60);

      if (diffS < 10) setLabel("Updated just now");
      else if (diffS < 60) setLabel(`Updated ${diffS}s ago`);
      else if (diffM < 60) setLabel(`Updated ${diffM}m ago`);
      else setLabel(`Updated ${Math.floor(diffM / 60)}h ago`);
    };

    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  return label;
}
