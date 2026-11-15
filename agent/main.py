"""Entry point: `uv run main.py dev` (local), `uv run main.py start` (a long-running
worker) or `uv run main.py one-shot` (one interview per Cloud Run job execution)."""

import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


class _HealthHandler(BaseHTTPRequestHandler):
    """Minimal readiness endpoint. Cloud Run (and any container host) probes
    $PORT with TCP/HTTP; the LiveKit worker itself does not bind $PORT."""

    def do_GET(self) -> None:
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args) -> None:  # keep startup logs readable
        pass


def serve_health() -> None:
    port = int(os.environ.get("PORT", "8080"))
    try:
        HTTPServer(("0.0.0.0", port), _HealthHandler).serve_forever()
    except OSError as error:
        # Another server (e.g. the agents CLI) already owns the port; fine.
        print(f"health server could not bind {port}: {error}", flush=True)


def one_shot() -> None:
    """One interview, then exit: the Cloud Run job started per interview."""
    import asyncio
    import logging
    import sys

    os.environ["INTERVIA_ONE_SHOT"] = "1"
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    from intervia_agent.oneshot import run_one_shot
    from intervia_agent.worker import server

    sys.exit(asyncio.run(run_one_shot(server)))


if __name__ == "__main__":
    import sys

    if sys.argv[1:2] == ["one-shot"]:
        one_shot()
    else:
        from intervia_agent.worker import main

        threading.Thread(target=serve_health, daemon=True).start()
        main()