# Video analysis: how good is it? (Nov 8, 2026)

Test case: Gayathri, AI Developer, 30-minute recording (640×480, about 20 fps, webcam in a lit room).

## Short answer
- **Our analysis and your own viewing agree.** Ours found her eyes going to one spot, up and to the left in the picture, in 14 of 21 answers, and rarely while listening. You saw the same thing when you watched ("looking at the left corner"). That is the best validation we have so far.
- **We could not get an independent AI read of the video.**
  - **Ominibot does not take video right now.** Text and single images work, but every video request returned "404 Not Found".
  - **Gemini was not used.** Sending the candidate's video to Gemini was blocked by my permissions, because only Ominibot was cleared.

  A ready prompt for you to run in ChatGPT or Gemini is at the end.
- **A local frame-by-frame check of 5 answers** (frames examined on this machine, nothing sent out) is consistent with ours:
  - in the flagged answers her gaze is fixed and steady;
  - in the unflagged ones her head moves, her eyes drop and close as she thinks, and she gestures.

  It cannot confirm "reading": at 640×480 her eyes are about 60 pixels wide, too small to see line-by-line movement in single frames.

## Per answer

| Answer (time) | Ours: same spot | Ours: reading-like | Local frame review |
|---|---|---|---|
| 0:14 (95 s) | Yes | Yes | Gaze steady and off-centre in most frames. Agrees. |
| 4:58 (163 s) | Yes | Yes | Steady, slightly lifted gaze, little head movement. Agrees. |
| 10:24 (short) | No | No | Looks up and away briefly (thinking). Agrees. |
| 12:41 (230 s) | Yes | Yes | Steady gaze, eyes half-lowered in many frames. Agrees on "steady"; reading not visible at this size. |
| 24:12 (40 s) | No | No | Animated: gestures, head turns, eyes close while thinking. Agrees. |

## How much to trust each check

| Check | Trust today | Why |
|---|---|---|
| Kept going back to one spot | **Good** | Calibrated to the candidate's own listening position; matched a human viewer here. |
| Reading-like eye movement | **Low to medium** | Needs fine eye detail. At 640×480, small sideways eye moves are close to landmark noise. Treat it as supporting evidence only. |
| Lips match the voice | **Medium** | Worked cleanly on all three long interviews (consistent 0.2–0.45 match, no false flags). Not yet tested against a real lip-sync cheat. |
| Same voice throughout | **Good** | Voice fingerprints were 0.86–0.96 similar across answers for single speakers. Not yet tested with a second speaker. |
| Another person or a phone in view | **Medium** | Standard detectors; a phone held below the camera is not visible at all. |
| Pause then smooth delivery | **New** | Added Nov 8; needs real interviews to judge. |

## What would make it more reliable
1. **Staged test calls (most important).** Six 2-minute calls:
   - honest;
   - a phone below the screen;
   - a second monitor;
   - reading ChatGPT on screen;
   - someone whispering;
   - mouthing along to another voice.

   Then each threshold can be tuned and its catch rate stated honestly.
2. **Record the candidate's camera at 720p instead of 640×480.** The eyes become twice the pixels, which is what reading detection needs. Cost: more storage and upload; analysis time grows about 2×.
3. **Hide the full question text while the candidate answers.** Today's call screen shows it, which is an honest reason to read, and it blurs the reading signal.
4. **A short gaze calibration at the start of the call:** "look at the top-left corner, then the bottom-right". The analysis then knows where the screen edges are for each person.
5. **Re-test Ominibot video** when the provider supports it, and keep it as a second opinion on flagged answers only (8–10 clips per interview, not the whole video), so cost stays low.

## Prompt for ChatGPT or Gemini (to compare yourself)
Upload short clips (40–60 s) of answers, ideally ones the report flags and ones it doesn't, and paste:

```
You review a short webcam clip of a job candidate ANSWERING an interview question on a laptop
(an AI interviewer asked the question; the candidate is speaking for the whole clip).
Describe only what you can see and hear. Do not guess about cheating; report observable behaviour.
Reply with one JSON object:
{
 "eyesOnScreenPercent": 0-100 (share of the clip the eyes look at the laptop screen around the camera),
 "whereEyesGoWhenAway": short text (e.g. "up-left above the camera", "down at the keyboard", "varies"),
 "returnsToSameSpot": true|false (keeps going back to ONE specific place away from the screen while speaking),
 "readingLike": "none"|"some"|"clear" (eyes moving side to side line by line, as when reading),
 "lipsMatchVoice": "yes"|"no"|"unclear",
 "anotherPersonOrVoice": true|false,
 "phoneOrNotesVisible": true|false,
 "lightingAndPicture": "good"|"dim"|"poor",
 "overallLooksLikeReadingAnswers": "low"|"medium"|"high",
 "notes": one or two sentences of what stood out
}
```

Then compare each answer with the report's "What the recording shows" list. Answers marked "Kept looking at one spot" should come back as `returnsToSameSpot: true`.

Clips used here: answers starting at 0:14, 2:10, 4:58, 10:24, 12:41, 17:02, 19:24 and 24:12 (45 s each, from 5 s into the answer).
