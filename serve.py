"""Local test server for Blundercheck: python serve.py, then open http://localhost:8765"""
import http.server
import mimetypes
import socketserver

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", 8765), Handler) as httpd:
        print("Serving on http://localhost:8765")
        httpd.serve_forever()
