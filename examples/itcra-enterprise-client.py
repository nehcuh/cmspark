"""ITCra worker SDK: bounded REST, opaque handles, no human signing authority.
Run with uv; stdlib only, suitable for offline images. Human proof issuance must
live in a separate authenticated RBAC/UI backend, never an Agent tool.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
import re

class EnterpriseClientError(Exception):
    def __init__(self, code, status):
        self.code, self.status = code, status
        super().__init__(code)

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class EnterpriseClient:
    def __init__(self, origin: str, grant_file: str, subject: str):
        url = urlsplit(origin)
        if url.scheme not in ("http", "https") or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
            raise ValueError("Companion URL must be an origin")
        file = Path(grant_file)
        if os.name != "nt" and file.stat().st_mode & 0o077:
            raise ValueError("grant file must be private (0600)")
        self._token = file.read_text().strip()
        self._base = origin.rstrip("/") + "/outbound-mcp/v1/enterprise"
        self.subject = subject
        self._opener = build_opener(NoRedirect())

    def _request(self, route: str, payload=None):
        if payload is not None and "subject" in payload:
            raise ValueError("subject is bound by the client")
        encoded = None if payload is None else json.dumps({**payload, "subject": self.subject}).encode()
        request = Request(self._base + route, data=encoded, headers={"Authorization": "Bearer " + self._token, "Content-Type": "application/json"})
        try:
            with self._opener.open(request, timeout=30) as response:
                data = response.read(4 * 1024 * 1024 + 1)
                if len(data) > 4 * 1024 * 1024:
                    raise ValueError("response budget exceeded")
                return json.loads(data)
        except HTTPError as error:
            try:
                body = json.loads(error.read(4096))
                code = body.get("error_code", "ENTERPRISE_HTTP_ERROR")
                if not isinstance(code, str) or not re.fullmatch(r"[A-Z_]{3,80}", code):
                    code = "ENTERPRISE_HTTP_ERROR"
            except (ValueError, AttributeError):
                code = "ENTERPRISE_HTTP_ERROR"
            finally:
                error.close()
            raise EnterpriseClientError(code, error.code) from None

    def capabilities(self):
        return self._request("/capabilities?" + urlencode({"subject": self.subject}))

    def open(self, url, request_key, change_id):
        return self._request("/sessions", {"url": url, "request_key": request_key, "change_id": change_id})

    def session(self, handle):
        return self._request("/sessions/" + self._handle(handle) + "?" + urlencode({"subject": self.subject}))

    def prepare(self, session, request_key, tool, args=None):
        return self._request("/operations", {"session_handle": self._handle(session), "request_key": request_key, "tool": tool, "args": args or {}})

    def execute_normal(self, operation):
        return self._request("/operations/" + self._handle(operation) + "/execute", {})

    def operation(self, handle):
        return self._request("/operations/" + self._handle(handle) + "?" + urlencode({"subject": self.subject}))

    def cancel(self, handle):
        return self._request("/operations/" + self._handle(handle) + "/cancel", {})

    @staticmethod
    def _handle(value):
        if not isinstance(value, str) or len(value) != 36 or any(c not in "0123456789abcdef-" for c in value):
            raise ValueError("invalid opaque handle")
        return value
