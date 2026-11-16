FROM asia-south1-docker.pkg.dev/siva-nikhil/meetingbot/agent:predev
COPY llm_candidate.py /app/scripts/llm_candidate.py
ENV CANDIDATE_TTS=gemini PYTHONUNBUFFERED=1
ENTRYPOINT ["/app/.venv/bin/python", "/app/scripts/llm_candidate.py"]
