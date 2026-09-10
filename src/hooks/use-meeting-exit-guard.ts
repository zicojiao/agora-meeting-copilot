"use client";

import { useCallback, useEffect, useRef } from "react";

export function useMeetingExitGuard(onPageExit: () => void) {
  const armedRef = useRef(true);
  const exitRef = useRef(onPageExit);
  exitRef.current = onPageExit;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!armedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const pageHide = () => {
      if (armedRef.current) exitRef.current();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", pageHide);
    };
  }, []);

  return useCallback(() => { armedRef.current = false; }, []);
}
