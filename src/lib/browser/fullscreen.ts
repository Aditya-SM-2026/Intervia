/**
 * Element fullscreen for the candidate interview.
 *
 * A live interview is one long, focused conversation, so it takes the whole
 * screen: no tab strip, no address bar, nothing of the browser around it.
 * Safari only shipped the unprefixed API recently, so the webkit spelling is
 * still accepted as a fallback.
 */

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function currentDocument(): FullscreenDocument | null {
  return typeof document === "undefined" ? null : (document as FullscreenDocument);
}

/** The element filling the screen, or null in the ordinary windowed view. */
export function fullscreenElement(): Element | null {
  const doc = currentDocument();
  if (!doc) return null;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isFullscreen(): boolean {
  return fullscreenElement() !== null;
}

/** False in browsers that only allow video fullscreen (older iOS Safari). */
export function isFullscreenSupported(): boolean {
  const doc = currentDocument();
  if (!doc) return false;
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
}

/**
 * Ask the browser to fill the screen with `element` (the page by default).
 *
 * Only a user gesture may open fullscreen, so this belongs at the top of a
 * click handler. A refusal is not an error worth interrupting the interview
 * for: the candidate stays in the tab, and the control in the call dock can
 * try again. Resolves true when the screen is now fullscreen.
 */
export async function requestFullscreen(element?: HTMLElement | null): Promise<boolean> {
  const target = element ?? currentDocument()?.documentElement;
  if (!target) return false;
  const candidate = target as FullscreenElement;

  try {
    if (typeof candidate.requestFullscreen === "function") {
      // navigationUI hides the browser's own chrome where the browser allows it.
      await candidate.requestFullscreen({ navigationUI: "hide" });
    } else if (typeof candidate.webkitRequestFullscreen === "function") {
      await candidate.webkitRequestFullscreen();
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Leave fullscreen. A no-op when the page already is not fullscreen. */
export async function exitFullscreen(): Promise<void> {
  const doc = currentDocument();
  if (!doc || !fullscreenElement()) return;

  try {
    if (typeof doc.exitFullscreen === "function") {
      await doc.exitFullscreen();
    } else if (typeof doc.webkitExitFullscreen === "function") {
      await doc.webkitExitFullscreen();
    }
  } catch {
    // Already out: the candidate pressed Escape, or the element was removed.
  }
}

/**
 * Run `listener` whenever the page enters or leaves fullscreen, however that
 * happened: our button, Escape, or the browser's own shortcut.
 */
export function onFullscreenChange(listener: () => void): () => void {
  if (typeof document === "undefined") return () => {};

  document.addEventListener("fullscreenchange", listener);
  document.addEventListener("webkitfullscreenchange", listener);
  return () => {
    document.removeEventListener("fullscreenchange", listener);
    document.removeEventListener("webkitfullscreenchange", listener);
  };
}
