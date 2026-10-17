import json
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import BoundedSemaphore
from urllib.parse import urlsplit

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
MEDAL_PATH = re.compile(r"^/games/[^/]+/clips/[^/]+/?$")
RESOLVE_SLOTS = BoundedSemaphore(6)


def normalize_medal_url(value):
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme != "https"
        or parsed.hostname not in {"medal.tv", "www.medal.tv"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or not MEDAL_PATH.fullmatch(parsed.path)
    ):
        raise ValueError("Use a public Medal clip link in the /games/.../clips/... format.")
    return parsed._replace(fragment="").geturl()


class ClipDeskHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_POST(self):
        if self.path != "/api/resolve":
            self.send_error(404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length < 1 or content_length > 4096:
                raise ValueError("The request was empty or too large.")
            payload = json.loads(self.rfile.read(content_length))
            medal_url = normalize_medal_url(payload.get("url", ""))
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, status=400)
            return

        if not RESOLVE_SLOTS.acquire(blocking=False):
            self.send_json({"error": "The clip resolver is busy. Try again shortly."}, status=503)
            return

        options = {
            "format": "best[ext=mp4]/best[protocol^=http]/best",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": 25,
            "retries": 1,
        }

        try:
            with YoutubeDL(options) as downloader:
                info = downloader.extract_info(medal_url, download=False)
            stream_url = info.get("url")
            stream = urlsplit(stream_url or "")
            if stream.scheme not in {"https", "http"} or not stream.hostname:
                raise DownloadError("No playable video stream was found for this clip.")
        except Exception as error:
            message = str(error).splitlines()[0][:240]
            self.send_json(
                {"error": f"Could not resolve this clip. It may be private or unavailable. {message}"},
                status=422,
            )
            return
        finally:
            RESOLVE_SLOTS.release()

        self.send_json(
            {
                "title": info.get("title") or "Medal clip",
                "uploader": info.get("uploader") or "Unknown creator",
                "duration": info.get("duration"),
                "video_url": stream_url,
            }
        )

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        print(f"{self.log_date_time_string()} {format_string % args}")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "0.0.0.0" if "PORT" in os.environ else "127.0.0.1")
    server = ThreadingHTTPServer((host, port), ClipDeskHandler)
    print(f"Kira Clip Desk listening on {host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()