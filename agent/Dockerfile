# Intervia interviewer agent (LiveKit Agents + Gemini Live).
# Build from the repository root: docker build -f agent/Dockerfile agent
FROM python:3.13-slim AS base

# Root certificates: the slim image ships none, so the Gemini client cannot
# build its TLS context and every live session fails on SSL.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY intervia_agent ./intervia_agent
COPY main.py ./

# Fetch model files (the voice-activity detector) at build time, not per start.
RUN uv run --no-dev main.py download-files

RUN useradd --create-home agent && chown -R agent /app
USER agent

# The worker connects out to LiveKit over WebRTC (UDP), so it cannot run on
# platforms without outbound UDP such as Cloud Run.
CMD ["uv", "run", "--no-dev", "main.py", "start"]
