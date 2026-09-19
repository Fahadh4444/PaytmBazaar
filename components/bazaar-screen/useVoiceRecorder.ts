"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording";

/** Formats Ask Bazaar's STT accepts, in order of preference (Chrome/Firefox: WebM, Safari: MP4). */
const FORMATS: [string, string][] = [
  ["audio/webm;codecs=opus", "webm"],
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/ogg;codecs=opus", "ogg"],
];

const UNSUPPORTED = "Voice input isn't supported in this browser. You can type your question instead.";
const BLOCKED = "Microphone access is blocked. Allow it in your browser settings, or type your question.";

/**
 * Records one spoken question with the browser's MediaRecorder. Stops by
 * itself after `maxSeconds`. `cancel` discards the recording; `stop` hands it
 * to `onRecorded`. Nothing is recorded until the merchant presses the button.
 */
export function useVoiceRecorder(onRecorded: (audio: Blob, filename: string) => void, maxSeconds = 30) {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);
  const callback = useRef(onRecorded);

  useEffect(() => {
    callback.current = onRecorded;
  }, [onRecorded]);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(UNSUPPORTED);
      return;
    }
    const format = FORMATS.find(([type]) => MediaRecorder.isTypeSupported(type));
    setState("requesting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (cause) {
      setState("idle");
      setError(cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError") ? BLOCKED : "No microphone was found. You can type your question instead.");
      return;
    }

    const chunks: Blob[] = [];
    const active = new MediaRecorder(stream.current, format ? { mimeType: format[0] } : undefined);
    recorder.current = active;
    cancelled.current = false;
    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    active.onstop = () => {
      const type = active.mimeType || format?.[0] || "audio/webm";
      const extension = FORMATS.find(([t]) => type.startsWith(t.split(";")[0]))?.[1] ?? "webm";
      release();
      setState("idle");
      setSeconds(0);
      if (!cancelled.current && chunks.length > 0) callback.current(new Blob(chunks, { type }), `question.${extension}`);
    };
    active.start();
    setSeconds(0);
    setState("recording");
    const started = Date.now();
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) stop();
    }, 250);
  }, [maxSeconds, release, stop]);

  // Never leave the microphone on after the dialog closes.
  useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    },
    [release],
  );

  return { state, seconds, maxSeconds, error, clearError: () => setError(null), start, stop, cancel };
}
