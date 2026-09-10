"use client";

import { useEffect, useRef, useState } from "react";

export function useMediaPreview({ cameraOn, micOn }: { cameraOn: boolean; micOn: boolean }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stopCurrent = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStream(null);
    };

    stopCurrent();
    setError(null);

    if (!cameraOn && !micOn) return stopCurrent;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera and microphone access are unavailable in this browser.");
      return stopCurrent;
    }

    void navigator.mediaDevices
      .getUserMedia({
        audio: micOn,
        video: cameraOn ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
      })
      .then((nextStream) => {
        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = nextStream;
        setStream(nextStream);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : "Camera or microphone permission was denied.";
        setError(message);
      });

    return () => {
      cancelled = true;
      stopCurrent();
    };
  }, [cameraOn, micOn]);

  return { stream, error };
}
