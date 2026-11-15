"""One interview per process, for a Cloud Run job started per interview.

The web app starts one job execution when the candidate passes the email gate,
with the interview id and LiveKit room name in the environment. This runner
joins that room directly (no dispatch, no other interview can land here), runs
the interview with the whole machine to itself, and exits once the job has
finished its shutdown work (recording upload, interview end). A slow or busy
interview can never starve another one, and a deploy never interrupts a live
interview: a running execution keeps the image it started with.

    uv run main.py one-shot
"""

from __future__ import annotations

import asyncio
import logging
import os
import time

from livekit import api
from livekit.agents import AgentServer, utils

from .worker import CANDIDATE_IDENTITY_PREFIX

logger = logging.getLogger("intervia.oneshot")

# Matches the web app's CANDIDATE_REJOIN_WINDOW_SECONDS: the room (and this
# interviewer) stay up for 5 minutes after the candidate drops.
DEPARTURE_TIMEOUT_SECONDS = 300
# The candidate passed the email gate and is checking camera and microphone.
# If they never come in, the machine shuts down instead of waiting forever.
NO_SHOW_SECONDS = float(os.environ.get("AGENT_NO_SHOW_SECONDS", "900"))
JOB_START_TIMEOUT_SECONDS = 60.0
POLL_SECONDS = 2.0
# After the job ends, how long its shutdown work (uploads) may still take.
DRAIN_TIMEOUT_SECONDS = 300


def interview_id_from_env() -> str | None:
    value = (os.environ.get("INTERVIA_INTERVIEW_ID") or "").strip()
    return value or None


async def _room_state(lk: api.LiveKitAPI, room: str) -> tuple[api.Room | None, list[api.ParticipantInfo]]:
    rooms = await lk.room.list_rooms(api.ListRoomsRequest(names=[room]))
    if not rooms.rooms:
        return None, []
    participants = await lk.room.list_participants(api.ListParticipantsRequest(room=room))
    return rooms.rooms[0], list(participants.participants)


def agent_token(key: str, secret: str, room: str, identity: str) -> str:
    """The interviewer's join token.

    simulate_job's own default token grants only join and the agent flag, so
    the interviewer could not set its own attributes: `lk.agent.state` never
    reached the candidate, whose screen stayed on "Connecting" through the
    whole interview. A dispatched job's token can update its own metadata;
    this one matches it.
    """
    return (
        api.AccessToken(key, secret)
        .with_identity(identity)
        .with_kind("agent")
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                agent=True,
                can_update_own_metadata=True,
            )
        )
        .to_jwt()
    )


def _is_agent(participant: api.ParticipantInfo) -> bool:
    return participant.kind == api.ParticipantInfo.Kind.AGENT


async def run_one_shot(server: AgentServer) -> int:
    room = (os.environ.get("INTERVIA_ROOM_NAME") or "").strip()
    if not room or not interview_id_from_env():
        logger.error("one-shot needs INTERVIA_ROOM_NAME and INTERVIA_INTERVIEW_ID")
        return 2

    url = os.environ["LIVEKIT_URL"]
    key = os.environ["LIVEKIT_API_KEY"]
    secret = os.environ["LIVEKIT_API_SECRET"]

    started = asyncio.Event()
    server.on("worker_started", lambda: started.set())
    run_task = asyncio.create_task(server.run(devmode=False, unregistered=True))
    started_wait = asyncio.create_task(started.wait())
    done, _ = await asyncio.wait({run_task, started_wait}, return_when=asyncio.FIRST_COMPLETED)
    if run_task in done:
        started_wait.cancel()
        run_task.result()
        return 1

    exit_code = 0
    async with api.LiveKitAPI(url, key, secret) as lk:
        info, participants = await _room_state(lk, room)
        if any(_is_agent(p) for p in participants):
            # Another execution already runs this interview (a second click on
            # the email gate). Two interviewers in one room would talk over
            # each other, so this one stands down.
            logger.warning("an interviewer is already in %s; exiting", room)
            await server.aclose()
            return 0
        if info is None:
            # The candidate is still on the device check. Create the room the
            # way their join token would, so a dropped candidate can rejoin.
            info = await lk.room.create_room(
                api.CreateRoomRequest(name=room, departure_timeout=DEPARTURE_TIMEOUT_SECONDS)
            )

        await server.simulate_job(
            room=room,
            fake_job=False,
            room_info=info,
            token=agent_token(key, secret, room, utils.shortuuid("agent-")),
        )
        logger.info("interviewer started for %s", room)

        # Wait for the job to show up, then for it to finish.
        deadline = time.monotonic() + JOB_START_TIMEOUT_SECONDS
        while not server.active_jobs:
            if time.monotonic() > deadline:
                logger.error("the interview job never started")
                exit_code = 1
                break
            await asyncio.sleep(0.5)

        joined_at: float | None = None
        no_show = False
        launched_at = time.monotonic()
        while server.active_jobs:
            await asyncio.sleep(POLL_SECONDS)
            if joined_at is not None:
                continue
            try:
                _, participants = await _room_state(lk, room)
            except Exception as error:  # noqa: BLE001 - a status check must not end the interview
                logger.warning("room check failed: %s", error)
                continue
            if any(p.identity.startswith(CANDIDATE_IDENTITY_PREFIX) for p in participants):
                joined_at = time.monotonic()
                logger.info("candidate joined %s", room)
            elif time.monotonic() - launched_at > NO_SHOW_SECONDS:
                logger.warning("no candidate joined %s in %.0f s; shutting down", room, NO_SHOW_SECONDS)
                no_show = True
                break

    if not no_show:
        # The job has ended; let any last shutdown work finish before exiting.
        try:
            await server.drain(timeout=DRAIN_TIMEOUT_SECONDS)
        except TimeoutError:
            logger.error("job shutdown did not finish in %d s", DRAIN_TIMEOUT_SECONDS)
            exit_code = exit_code or 1
    await server.aclose()
    run_task.cancel()
    logger.info("one-shot interviewer finished (exit %d)", exit_code)
    return exit_code
