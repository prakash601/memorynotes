"use client";

import { useEffect } from "react";

/** Registers the PWA service worker (no-op where unsupported). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline support is best-effort; the app works without it.
      });
    }
  }, []);
  return null;
}
