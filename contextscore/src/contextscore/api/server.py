"""
ContextScore HTTP API Server

A lightweight JSON API for scoring context quality.
Uses only stdlib (http.server) — no Flask/FastAPI dependency.

Usage:
    python -m contextscore.api.server --port 8080

Endpoints:
    POST /score       Score a context window
    POST /score/batch Score multiple context windows
    GET  /health      Health check
"""

from __future__ import annotations

import json
import sys
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any

from contextscore import ContextScorer


class ScorerHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the scoring API."""

    scorer: ContextScorer  # Set by server factory

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {
                "status": "ok",
                "version": "0.1.0",
                "analyzers": len(self.scorer.analyzers),
            })
        else:
            self._json_response(404, {"error": "Not found"})

    def do_POST(self):
        try:
            body = self._read_body()
        except Exception as e:
            self._json_response(400, {"error": f"Invalid request body: {e}"})
            return

        if self.path == "/score":
            self._handle_score(body)
        elif self.path == "/score/batch":
            self._handle_batch(body)
        else:
            self._json_response(404, {"error": "Not found"})

    def _handle_score(self, body: dict):
        context = body.get("context", "")
        query = body.get("query", "")
        segments = body.get("segments")
        cost = body.get("cost_per_million")

        if cost is not None:
            self.scorer.cost_per_million = float(cost)

        if not context and not segments:
            self._json_response(400, {"error": "Provide 'context' or 'segments'"})
            return

        result = self.scorer.score(
            context=context,
            query=query,
            segments=segments,
        )
        self._json_response(200, result.to_dict())

    def _handle_batch(self, body: dict):
        items = body.get("items", [])
        if not items:
            self._json_response(400, {"error": "Provide 'items' array"})
            return

        results = self.scorer.score_batch(items)
        self._json_response(200, {
            "results": [r.to_dict() for r in results],
            "count": len(results),
        })

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        return json.loads(raw) if raw else {}

    def _json_response(self, status: int, data: Any):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        """Quieter logging."""
        sys.stderr.write(f"[ContextScore API] {args[0]} {args[1]}\n")


def create_server(host: str = "0.0.0.0", port: int = 8080) -> HTTPServer:
    """Create and return the HTTP server."""
    scorer = ContextScorer()
    ScorerHandler.scorer = scorer

    server = HTTPServer((host, port), ScorerHandler)
    return server


def main():
    parser = argparse.ArgumentParser(description="ContextScore API Server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    server = create_server(args.host, args.port)
    print(f"ContextScore API running on http://{args.host}:{args.port}")
    print(f"  POST /score        — Score a context window")
    print(f"  POST /score/batch  — Score multiple contexts")
    print(f"  GET  /health       — Health check")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
