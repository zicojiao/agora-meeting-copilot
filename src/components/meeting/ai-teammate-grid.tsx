"use client";

import { useCallback, useState } from "react";
import { BackgroundRippleEffect } from "@/components/ui/background-ripple-effect";
import { WebcamPixelGrid } from "@/components/ui/webcam-pixel-grid";
import { cn } from "@/lib/utils";

export function AiTeammateGrid() {
  const [webcamReady, setWebcamReady] = useState(false);
  const handleWebcamReady = useCallback(() => setWebcamReady(true), []);
  const handleWebcamError = useCallback(() => setWebcamReady(false), []);

  return (
    <div className="home-ai-grid absolute inset-x-0 bottom-14 top-[58px] overflow-hidden max-sm:bottom-[52px]">
      <div
        aria-hidden="true"
        className={cn("home-ripple-layer absolute inset-0 opacity-90 transition-opacity duration-700 [&>div]:[--cell-border-color:rgba(0,194,255,0.18)]! [&>div]:[--cell-fill-color:#10171b]! [&>div]:[--cell-shadow-color:rgba(56,211,159,0.2)]!", webcamReady && "pointer-events-none opacity-[0.08]")}
      >
        <BackgroundRippleEffect cols={27} rows={18} cellSize={56} />
      </div>
      <div className={cn("home-webcam-layer pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-1000", webcamReady && "opacity-75")} data-ready={webcamReady}>
        <WebcamPixelGrid
          backgroundColor="#0a0c0e"
          borderColor="#dff8ff"
          borderOpacity={0.1}
          colorMode="webcam"
          darken={0.42}
          gapRatio={0.12}
          gridCols={64}
          gridRows={48}
          maxElevation={18}
          motionSensitivity={0.34}
          onWebcamError={handleWebcamError}
          onWebcamReady={handleWebcamReady}
        />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(14,17,19,0.76)_0%,rgba(14,17,19,0.2)_48%,rgba(14,17,19,0.62)_100%),linear-gradient(180deg,rgba(14,17,19,0.34)_0%,transparent_35%,rgba(14,17,19,0.48)_100%)]" />
    </div>
  );
}
