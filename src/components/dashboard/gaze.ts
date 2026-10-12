import type { GazeDirection } from "@/lib/interviews/scorecard.types";

/** Directions as seen in the picture, in reading order of a 3-by-3 grid. */
export const GAZE_GRID: GazeDirection[] = [
  "up_left",
  "up",
  "up_right",
  "left",
  "centre",
  "right",
  "down_left",
  "down",
  "down_right",
];

export const GAZE_LABEL: Record<GazeDirection, string> = {
  centre: "Straight ahead",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  up_left: "Up left",
  up_right: "Up right",
  down_left: "Down left",
  down_right: "Down right",
  unclear: "Could not tell",
};
