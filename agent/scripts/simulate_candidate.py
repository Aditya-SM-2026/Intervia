"""Simulated candidate: joins an interview room and speaks scripted answers.

A development tool for testing the interviewer end to end without a browser
or a human. It publishes real audio (synthesized with the macOS `say`
command), so the agent's whole voice path is exercised: turn detection,
Gemini Live, tool calls, capture.

    uv run scripts/simulate_candidate.py --interview-id <id> [--answers file.txt] [--stay]

Without --answers a short built-in script is used. The room and the agent
dispatch are created by the join token, exactly as the web app does it.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from livekit import api, rtc

from intervia_agent.config import AGENT_NAME, CLIENT_EVENT_TOPIC, load_env

SAMPLE_RATE = 48000
FRAME_SAMPLES = SAMPLE_RATE // 100  # 10 ms

DEFAULT_ANSWERS = [
    "Hi, thanks for having me. I'm Asha, a backend engineer with five years of experience, "
    "mostly building payment services in Python and Go at a fintech startup.",
    "Sure. The most relevant project was rebuilding our ledger service. I owned the design and "
    "the migration. We moved from a single Postgres table to an append-only event log, and I "
    "wrote the reconciliation job that compared the old and new balances every night.",
    "The hardest part was the cutover without downtime. I ran both systems in parallel for two "
    "weeks behind a feature flag, and we only switched once the mismatch rate was zero for five "
    "days. Latency at the ninety-ninth percentile dropped from four hundred to ninety milliseconds.",
    "Once I disagreed with our product manager about shipping without idempotency keys. I showed "
    "him two real duplicate-charge incidents from the logs, and we agreed to delay by one sprint.",
    "No, I think that covers it. Thank you.",
]


def synthesize(text: str, directory: str, index: int) -> bytes:
    """Returns 48 kHz mono 16-bit PCM for the text, using macOS `say`."""
    path = os.path.join(directory, f"utterance-{index}.wav")
    subprocess.run(
        ["say", "-o", path, f"--data-format=LEI16@{SAMPLE_RATE}", text],
        check=True,
    )
    with wave.open(path, "rb") as wav:
        pcm = wav.readframes(wav.getnframes())
    # Drop trailing silence so "the candidate stopped" means the last word.
    end = len(pcm)
    while end >= 2 and abs(int.from_bytes(pcm[end - 2 : end], "little", signed=True)) < 200:
        end -= 2
    return pcm[:end]


class Candidate:
    def __init__(self, room: rtc.Room, source: rtc.AudioSource) -> None:
        self.room = room
        self.source = source
        self.agent_state = "unknown"
        self.agent_spoke_at: float | None = None
        self.transcript: list[tuple[str, str]] = []
        self._pcm: bytes | None = None
        self._offset = 0
        self._done = asyncio.Event()

    async def pump(self) -> None:
        """Feeds the microphone track continuously: speech when queued, else silence."""
        silence = bytes(FRAME_SAMPLES * 2)
        while True:
            data = silence
            if self._pcm is not None:
                chunk = self._pcm[self._offset : self._offset + FRAME_SAMPLES * 2]
                self._offset += FRAME_SAMPLES * 2
                if len(chunk) < FRAME_SAMPLES * 2:
                    self._pcm = None
                    self._done.set()
                    chunk = chunk + silence[len(chunk) :]
                data = chunk
            await self.source.capture_frame(
                rtc.AudioFrame(data, SAMPLE_RATE, 1, FRAME_SAMPLES)
            )

    async def say(self, pcm: bytes) -> None:
        self._done.clear()
        self._offset = 0
        self._pcm = pcm
        await self._done.wait()

    async def wait_for_agent_turn(self, timeout: float = 45.0) -> float | None:
        """Waits until the agent has spoken and gone quiet; returns its response delay."""
        asked_at = time.monotonic()
        self.agent_spoke_at = None
        deadline = asked_at + timeout
        while time.monotonic() < deadline and self.agent_spoke_at is None:
            await asyncio.sleep(0.05)
        if self.agent_spoke_at is None:
            return None
        delay = self.agent_spoke_at - asked_at
        quiet_since: float | None = None
        while time.monotonic() < deadline + 60:
            if self.agent_state == "speaking":
                quiet_since = None
            else:
                quiet_since = quiet_since or time.monotonic()
                if time.monotonic() - quiet_since > 2.5:
                    break
            await asyncio.sleep(0.05)
        return delay


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--interview-id", default=f"sim-{uuid.uuid4().hex[:10]}")
    parser.add_argument("--answers", help="Text file with one spoken answer per line")
    parser.add_argument("--stay", action="store_true", help="Stay connected until the agent ends the interview")
    parser.add_argument("--loop", action="store_true", help="Repeat the answers until the interview ends")
    parser.add_argument("--think", type=float, default=0.0, help="Seconds of silence before each answer")
    parser.add_argument("--token", help="Join token from the web app's verify endpoint (default: mint one)")
    parser.add_argument("--tab-switch", action="store_true", help="Send a tab-hidden event mid-interview")
    args = parser.parse_args()

    load_env()
    answers = DEFAULT_ANSWERS
    if args.answers:
        answers = [line.strip() for line in Path(args.answers).read_text().splitlines() if line.strip()]

    with tempfile.TemporaryDirectory() as directory:
        print(f"synthesizing {len(answers)} answers…")
        clips = [synthesize(text, directory, index) for index, text in enumerate(answers)]

    room_name = f"interview-{args.interview_id}"
    token = args.token or (
        api.AccessToken()
        .with_identity(f"candidate-{uuid.uuid4()}")
        .with_name("Simulated candidate")
        .with_grants(api.VideoGrants(room_join=True, room=room_name))
        .with_room_config(
            api.RoomConfiguration(
                departure_timeout=60,
                agents=[
                    api.RoomAgentDispatch(
                        agent_name=AGENT_NAME,
                        metadata=json.dumps({"interviewId": args.interview_id}),
                    )
                ]
            )
        )
        .to_jwt()
    )

    room = rtc.Room()
    # A short queue keeps "finished speaking" honest: with the default one-second
    # queue the last second of speech is still being sent when say() returns.
    source = rtc.AudioSource(SAMPLE_RATE, 1, queue_size_ms=60)
    candidate = Candidate(room, source)
    ended = asyncio.Event()

    @room.on("participant_attributes_changed")
    def _attributes(changed: dict[str, str], participant: rtc.Participant) -> None:
        state = changed.get("lk.agent.state")
        if state:
            candidate.agent_state = state
            if state == "speaking" and candidate.agent_spoke_at is None:
                candidate.agent_spoke_at = time.monotonic()

    @room.on("disconnected")
    def _disconnected(*_: object) -> None:
        ended.set()

    async def _read(reader: rtc.TextStreamReader, identity: str) -> None:
        text = (await reader.read_all()).strip()
        if text and reader.info.attributes.get("lk.transcription_final", "true") != "false":
            speaker = "candidate" if identity.startswith("candidate-") else "interviewer"
            candidate.transcript.append((speaker, text))
            print(f"  [{speaker}] {text}")

    room.register_text_stream_handler(
        "lk.transcription", lambda reader, identity: asyncio.create_task(_read(reader, identity))
    )

    await room.connect(os.environ["LIVEKIT_URL"], token)
    track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    pump = asyncio.create_task(candidate.pump())
    print(f"joined {room_name}; waiting for the interviewer…")

    delays: list[float] = []
    greeting = await candidate.wait_for_agent_turn(timeout=40)
    if greeting is None:
        print("FAIL: the interviewer never spoke")
    else:
        print(f"  (interviewer started speaking {greeting:.1f}s after join)")
        index = -1
        while not ended.is_set():
            index += 1
            if index >= len(clips) and not args.loop:
                break
            clip = clips[index % len(clips)]
            if args.tab_switch and index == 2:
                await room.local_participant.send_text(
                    json.dumps({"type": "tab_hidden"}), topic=CLIENT_EVENT_TOPIC
                )
            if args.think:
                # A candidate who thinks before answering: the interviewer must wait.
                await asyncio.sleep(args.think)
                if ended.is_set():
                    break
            await candidate.say(clip)
            delay = await candidate.wait_for_agent_turn()
            if delay is None:
                print("  (no reply from the interviewer)")
                break
            delays.append(delay)
            print(f"  (reply began {delay:.2f}s after the candidate stopped)")

    if args.stay and not ended.is_set():
        print("staying until the interviewer ends the interview…")
        try:
            await asyncio.wait_for(ended.wait(), timeout=120)
        except TimeoutError:
            print("  (interviewer did not end within 120s)")

    ended_by_agent = ended.is_set()
    pump.cancel()
    await room.disconnect()
    if delays:
        ordered = sorted(delays)
        print(
            f"reply delay: median {ordered[len(ordered) // 2]:.2f}s, "
            f"min {ordered[0]:.2f}s, max {ordered[-1]:.2f}s over {len(delays)} turns"
        )
    print(f"transcript lines: {len(candidate.transcript)}; room ended by agent: {ended_by_agent}")


if __name__ == "__main__":
    asyncio.run(main())
