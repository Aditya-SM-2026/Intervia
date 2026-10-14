"""Entry point: `uv run main.py dev` (local) or `uv run main.py start` (production)."""

import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from intervia_agent.worker import main


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


if __name__ == "__main__":
    threading.Thread(target=serve_health, daemon=True).start()
    main()