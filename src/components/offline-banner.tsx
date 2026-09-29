"use client";

import { useEffect, useState } from "react";
import { OFFLINE_QUEUE_EVENT, getBrowserDraftStore } from "@/lib/offline-queue";

export function OfflineBanner() {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const entries = await getBrowserDraftStore().list();
        if (!cancelled) {
          setPending(entries.length);
        }
      } catch {
        if (!cancelled) {
          setPending(0);
        }
      }
    }

    function handleOnline() {
      setOnline(true);
      void refresh();
    }
    function handleOffline() {
      setOnline(false);
    }

    void refresh();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener(OFFLINE_QUEUE_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, refresh);
    };
  }, []);

  if (online && pending === 0) {
    return null;
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-40 w-full bg-amber-100 px-6 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      {!online
        ? pending > 0
          ? `You are offline. ${pending} draft${pending === 1 ? "" : "s"} will sync when reconnected.`
          : "You are offline. Edits will queue on this device and sync when reconnected."
        : `${pending} offline draft${pending === 1 ? "" : "s"} waiting to sync…`}
    </div>
  );
}
