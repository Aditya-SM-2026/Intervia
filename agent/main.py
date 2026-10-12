"""Entry point: `uv run main.py dev` (local) or `uv run main.py start` (production)."""

from intervia_agent.worker import main

if __name__ == "__main__":
    main()
