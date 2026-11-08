# Evaluation redesign plan (Nov 2026)

Starting case: **Gayathri, AI Developer, 30 min, Oct 29.** The report says **70, "Hire"**. The transcript shows mostly textbook definitions, no retrieval knowledge and no deployment experience. A reviewer would say "not yet".

## 1. What is wrong today

### 1.1 The overall score mixes "can they do the job" with "did they cheat"
`scoring.ts` averages four factors: answers 45, resume 20, own answers 20, video 15.

- **Own answers and video are integrity checks, not ability.** An honest candidate who knows nothing still gets 100 + 82 there. That lifts a 44 to a 70.
- **Own answers defaults to 100.** It starts at 100 and only loses points for flags. For Gayathri the LLM check **never ran**: answer quality was 44, under the 50-point cost bar, so it was skipped. The 100 just means "not checked". Talking about a movie would also score 100.
- **Resume match pays for mentioning a project.** "She described Wanderlust" counts as confirmed. Depth isn't required, so this is close to free points.
- **The answer scale is lenient by design.** The grader prompt says: "a 3 even if a follow-up probe went unanswered". It also says it must not compare the answer with what the role needs. Definition-style answers ("API stands for…") still collect 2s and 3s.
- **"Off-topic" sits in the wrong place.** It is part of own answers today, but it is about relevance, which belongs in answer quality.

### 1.2 The video analysis can't see what it is meant to see
`worker/analyse.py`: OpenCV + MediaPipe Face Mesh, iris offset + head pose, **1 frame per second**. Each frame goes into one of 10 direction buckets, and each answer gets its most common bucket.

| Problem | Effect in reports |
|---|---|
| "Centre" means looking **at the camera**. Nobody looks at the camera; they look at the screen below it. | Gayathri: "0% at the screen while answering" and still "Good, 82". Every honest laptop user reads as looking "down". |
| No per-person calibration. Fixed thresholds for every face, camera height and laptop. | Glasses, camera position or a tall monitor shift everything. |
| 1 fps | Reading can't be detected: reading eye movements need many frames per second. The recording has 15 fps. |
| Only buckets, no actual gaze points | "Same spot" means "same bucket". A phone below the screen and looking at the keyboard both come out as "down". |
| Ignores thinking. People look away when recalling or thinking (Glenberg et al. 1998; Doherty-Sneddon). | False flags on honest people, especially nervous ones. |
| `max_num_faces=1`, no object detection | A second person or a phone is never seen. |
| Audio not used | No lip-sync check, no "different voice" check, no read-aloud prosody. |

## 2. Target design

### 2.1 Two separate results, not one blended number
1. **Ability score, 0–100.** Answer quality, with project depth as part of it. This alone drives Hire / Maybe / Not yet.
2. **Integrity: Clear / Worth a look / High risk.** Built from own answers, video and audio. It never adds points to ability. It can only hold a candidate back:
   - High risk → recommendation becomes "Review before deciding";
   - Worth a look → the clips to watch are listed.
3. **Any check that didn't run shows "Not checked", never 100.**
4. Remove the cost bar for the integrity checks: own answers is one cheap text call and video is CPU-only. The bar exists to save money, but it currently changes the result.

Gayathri under this design: ability about 40–45 → **Not yet**, integrity Clear. That matches a human reading of the transcript.

### 2.2 Answer quality: did they answer the question, and did they really do it
For each question **plus its follow-ups** (scored as one exchange), the grader gives four sub-scores with short anchors:

| Dimension | Question it answers | Low end |
|---|---|---|
| Relevance | Did it address what was asked? | Talks about something else (her spam classifier for a retrieval question) |
| Ownership and specificity | Concrete first-person detail: what *they* built, tools, decisions, problems, numbers | Generic "we can do X" |
| Correctness | Is what they said technically right? | Wrong or confused |
| Depth | How and why, trade-offs, what failed | Definition only |

Rules:
- **Definition-only answers** to an experience question are capped at 2 out of 5.
- **The follow-up counts.** A fluent overview that falls apart under the probe is scored down.
- **Expected-answer anchors come from the plan.** When the plan is built, each question gets "good" and "excellent" anchors. The grader measures against them, so the role sets the bar.
- **Project depth replaces resume match.** For each resume project, ask: could they explain how it works, a problem they hit, and why they made a choice? Mentioning the project is not enough to count as confirmed.
- **Two graders always run.** A cheap model is fine. If they disagree by 2 or more points, the answer goes to human review.

### 2.3 Own answers: their own words, or read out
The question: does the answer sound like this person thinking aloud, or like a textbook or AI text being read?

**Compare each answer with the candidate's own baseline.** The intro, small talk and their questions at the end show how this person really speaks. The check looks for a jump away from that baseline.

Per answer, three groups of signals:

- **Measured from audio**, free:
  - pause before speaking;
  - speech rate and how much it varies;
  - pause pattern inside the answer;
  - filled pauses ("uh", "um"; the live transcript drops these, so they come from the audio);
  - pitch range, via Parselmouth/Praat.

  Read speech has steadier pacing, fewer hesitations and fewer self-corrections. Research classifiers reach about 70–90% accuracy and are speaker-dependent, so this is a supporting signal only.
- **From the text**, in one LLM call:
  - textbook opening ("X stands for…", "X is nothing but…");
  - list structure;
  - vocabulary jump against the baseline;
  - no first-person detail;
  - polished overview, then no specifics when probed.
- **AI-likeness.** At plan time, generate a model answer for each planned question once. Then measure how close the candidate's wording is to it, by embedding similarity. Close wording plus a style jump is a strong signal. On its own it is weak: AI-text detectors are unreliable on short spoken text.

Output for each answer: **Natural / Polished, check / Likely read or fed**, each with its reasons and timestamp. Interview level: the pattern across answers. One odd answer is noise; three is a pattern.

### 2.4 Video and audio integrity, all open source and CPU-only
No video goes to an LLM. Python extracts numbers; the LLM sees only a small table of numbers per answer and writes the explanation. The arithmetic for flags stays in code.

**Step 1: calibrate to the person.** Keep continuous gaze angles, not buckets. During the listening windows the candidate looks at the interview screen, so the centre of those gaze points becomes "the screen" for that person and camera. Everything after is measured against that baseline.

**Step 2: signals.**

| # | Signal | How | Catches |
|---|---|---|---|
| V1 | **Fixed off-screen spot** | Cluster answer-time gaze points (DBSCAN). Find a tight cluster away from the screen baseline. Measure: share of answer time in it, how many answers return to it, how quickly the eyes go there after the question ends. | A phone below the screen, a second monitor, notes |
| V2 | **Reading pattern** | Analyse answer windows at 15 fps. Look for a slow drift left-to-right, then a fast jump back, repeating every few seconds (line-by-line reading). | Reading an AI answer on screen or on a phone |
| V3 | **Thinking vs fetching** | Thinking gaze wanders and varies by question (up, side, defocused). Fetching goes to the same spot every time and stays there while talking. | Removes false flags on honest people |
| V4 | **Lip-sync** | MediaPipe mouth opening vs audio loudness envelope, correlated per answer. Low correlation or a lag means the voice is not coming from that mouth. Upgrade path: Light-ASD (1M params, CVPR 2023) or SyncNet. | Someone else answering while the candidate mouths along |
| V5 | **Voice consistency** | Speaker embedding per answer (SpeechBrain ECAPA or Resemblyzer), compared with the intro. Second-voice detection with pyannote if needed. | A different person answering, a whispering helper |
| V6 | **Second face or a phone** | Face detector with up to 3 faces. A phone detector with a permissive licence (MediaPipe EfficientDet-Lite or RT-DETR, Apache). Avoid Ultralytics YOLO, which is AGPL. | A helper in the frame, a phone in hand |
| V7 | **Tab and focus** | Already measured | Switching to another window |

**Step 3: score.** Per answer, collect the evidence from V1–V6, with timestamps. At interview level:
- **High risk:** a strong signal in 3 or more answers (same spot + reading, a lip-sync break, a different voice, a second face).
- **Worth a look:** weaker or isolated signals.
- **Clear:** otherwise.

The report shows the moments to watch, not a fake-precise percentage.

**Gaze model choice.** Start with MediaPipe, fixing calibration, 15 fps and clustering: most of the gain comes from those, not from a better model. Add L2CS-Net only if staged tests show MediaPipe is too noisy at 640×360. Its code is MIT, but its Gaze360 weights are research-only, so the licence needs a check for commercial use.

**Fusion rule.** Flag **High risk** only when at least **2 different kinds of evidence** agree on the **same answer**. For example, a fixed off-screen spot or reading sweeps, together with read-aloud prosody (no hesitations, even pace). One kind of evidence alone is at most "Worth a look".

### 2.5 Tool stack (licence-checked for a paid product)
| Job | Tool | Licence |
|---|---|---|
| Split audio into interviewer / thinking pause / candidate speaking | Silero VAD | MIT |
| Word timings, keeping "uh/um" (the live transcript drops them) | faster-whisper `base`/`small`, int8, prompted to transcribe verbatim | MIT |
| Voice consistency | WeSpeaker ECAPA (ONNX) or SpeechBrain ECAPA | Apache 2.0 |
| Pitch and pace | librosa + pyworld | ISC / MIT |
| Faces, head pose, mouth opening | MediaPipe FaceLandmarker, OpenCV YuNet for multiple faces | Apache 2.0 |
| Better gaze, only if needed | L2CS-Net / MobileGaze ONNX | Code MIT. Gaze360 weights are research-only: retrain or check terms |
| Lip-sync fallback | Light-ASD | MIT |
| Phone or second person | YOLOX-S ONNX at 1 fps | Apache 2.0 |
| Gaze spot clustering | HDBSCAN (scikit-learn) | BSD |

**Avoid in a paid product:**
- openSMILE: non-commercial licence;
- CrisperWhisper weights: CC-BY-NC;
- Ultralytics YOLO: AGPL;
- Parselmouth: GPL, which is fine server-side but not for on-prem delivery.

**Compute.** A 30-minute recording runs in about 3–4 minutes on the existing 2-vCPU worker:
- audio first;
- one 15 fps face pass;
- gaze at 15 fps on candidate-speaking and thinking windows only;
- objects at 1 fps.

These timings are estimates from the research, not measured yet.

## 3. Honest limits
- **A tool that sits right under the camera is hard to catch.** Teleprompter-style AI overlays can sit at the top of the screen, next to the camera, and look almost the same as looking at the interviewer. The reading pattern (V2) and own answers (2.3) are the only real defence there.
- **640×360 is low for eyes.** The iris is only a few pixels wide, so gaze will stay approximate. Glasses glare and dim rooms make it worse.
- **Nervous, neurodivergent or non-native candidates** pause, look away and speak unevenly. Integrity results must stay "review", never an automatic reject.
- **AI-text detection is weak on short spoken answers.** Use it only together with the other signals.

## 4. Plan, in order
1. **Fix the orchestration:**
   - ability and integrity separated;
   - no default 100;
   - integrity checks always run;
   - recommendation driven by ability, held back by integrity.

   Re-score existing interviews and compare.
2. **Answer quality:** the four dimensions, follow-ups included, plan anchors, project depth replacing resume match, two graders.
3. **Own answers:** the candidate baseline, audio prosody features, text signals, AI-likeness from model answers at plan time.
4. **Video v2:**
   - calibration from the listening windows;
   - continuous gaze;
   - 15 fps on answer windows only, which keeps CPU time reasonable;
   - DBSCAN spot;
   - reading pattern;
   - multi-face detection.
5. **Audio-visual:** lip-sync, voice consistency, phone detector.
6. **Staged test set**, short runs of about 2 minutes each. One honest run, then one for each cheat:
   - phone below the screen;
   - a second monitor;
   - reading a ChatGPT answer on screen;
   - a helper whispering;
   - mouthing along to someone else.

   Measure catches and false flags for each signal, then tune the thresholds.
7. **Report UI:** ability score plus an integrity badge, with the clips to watch.

## 5. Status (Nov 7, 2026): built

| Part | Where |
|---|---|
| **Score is ability only.** Answers 80%, resume depth 20%. `SCORE_WEIGHTS` now takes two parts; an old four-part value keeps its first two. | `scoring.ts` (`DEFAULT_WEIGHTS`, `overallScore`) |
| **Integrity** (Clear / Worth a look / High risk / Checking video / Not checked), separate from the score. "High risk" needs two sources agreeing on the same answers, or a hard sign. | `scoring.ts` (`measuredFindings`, `integrityLevel`, `buildIntegrityCheck`) |
| "Hire" becomes **"Review before deciding"** when integrity is High risk | `report-insights.ts` |
| **Checks always run** for a real transcript. The 50-point bar is gone; only near-empty test calls skip them. A check that didn't run shows "Not checked", never 100. | `scorecard.service.ts` (`buildScorecard`, `buildAuthenticity`) |
| **Answer grading:** four dimensions, the follow-ups graded with the question, the plan's anchors in the rubric, and caps in code (definitions only → max 2; off the question → max relevance) | `GRADER_PROMPT`, `cappedAnswerScore` |
| The second grader's scores were never attached (a bug). Now they are, so a disagreement flags the report. | `buildScorecard` |
| **Resume depth:** "confirmed" needs how / why / their part; only naming a project is "partly" | `RESUME_CHECK_PROMPT` |
| **Own answers:** learns the candidate's baseline from the intro and small talk, then reads each answer as Own words / More polished / Sounds read out | `AUTHENTICITY_PROMPT` |
| **Video worker v2:**<br>• gaze calibrated to the listening windows;<br>• every frame of answers and thinking pauses;<br>• DBSCAN fixed spot;<br>• reading sweeps;<br>• lip-sync (mouth opening vs voice loudness);<br>• face count;<br>• YOLOX phone and person detection;<br>• low-light enhancement (gamma + CLAHE + denoise, upscaling for small faces) | `worker/measure_video.py`, `features.py`, `objects.py` |
| **Audio:**<br>• verbatim faster-whisper (keeps "um/uh", repeats, pauses, pace);<br>• WeSpeaker voice fingerprint per answer against the candidate's other answers | `worker/audio.py` |
| **The model writes the integrity note** after the video lands. The level stays decided in code. | `writeIntegritySummary`, `api/internal/video-result` |
| **Report:**<br>• integrity tile and section with play-from-moment links;<br>• a "processing the video" state;<br>• dimension chips per answer;<br>• calibrated On camera tiles | `InterviewDetailView.tsx` |
| **Infrastructure:**<br>• Cloud Tasks deadline raised to 30 min (it was 10, so long jobs were retried mid-run);<br>• predev worker at 4 GiB, one job per instance | `cloud-tasks.ts`, `deploy-predev.yml` |

**Thresholds are first guesses.** They were set from the literature and from reasoning, not from labelled data. They still need the staged test interviews in step 6:
- fixed spot held in ≥30% of an answer, in ≥3 answers;
- lip-sync correlation <0.05 when the candidate's usual is ≥0.2;
- voice similarity 0.2–0.3 below their usual;
- read-aloud at ≤25% of their usual hesitation rate.
