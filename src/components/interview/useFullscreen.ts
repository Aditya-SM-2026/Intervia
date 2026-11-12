"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  exitFullscreen,
  isFullscreen,
  isFullscreenSupported,
  onFullscreenChange,
  requestFullscreen,
} from "@/lib/browser/fullscreen";

const subscribe = (onChange: () => void) => onFullscreenChange(onChange);
/** The server and the first client paint always see the windowed view. */
const getServerSnapshot = () => false;

/**
 * Tracks the page's real fullscreen state, so a control can show the right
 * icon even when the candidate leaves with Escape instead of the button.
 */
export function useFullscreen() {
  const active = useSyncExternalStore(subscribe, isFullscreen, getServerSnapshot);
  const supported = useSyncExternalStore(subscribe, isFullscreenSupported, getServerSnapshot);

  const enter = useCallback(() => requestFullscreen(), []);
  const exit = useCallback(() => exitFullscreen(), []);
  const toggle = useCallback(async () => {
    if (isFullscreen()) await exitFullscreen();
    else await requestFullscreen();
  }, []);

  return { active, supported, enter, exit, toggle };
}
