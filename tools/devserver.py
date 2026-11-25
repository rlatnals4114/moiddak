# 로컬 미리보기 서버: moiddak/public 을 캐시 없이 보여 준다(고친 파일이 새로고침 한 번에 보이도록).
# 실행: python3 moiddak/tools/devserver.py  → http://localhost:4173
import functools
import http.server
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "public"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    http.server.ThreadingHTTPServer(("127.0.0.1", 4173), handler).serve_forever()
