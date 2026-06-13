"""Tests de providers.py: cuerpos de petición, parsers de streaming, resolución
de config, extracción de JSON y call_provider end-to-end (streaming SSE real +
timeout de inactividad) contra un servidor HTTP local."""
import json
import os
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
import providers

# Variables de entorno que pueden falsear resolve_ai_config: las quitamos.
_AI_ENV = ["JOB_AI_PROVIDER", "JOB_AI_MODEL", "JOB_AI_BASE_URL", "JOB_AI_API_KEY",
           "JOB_AI_TIMEOUT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
           "GOOGLE_API_KEY", "GEMINI_API_KEY"]


def clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if k not in _AI_ENV}
    env.update(extra)
    return patch.dict(os.environ, env, clear=True)


class TestStreamDelta(unittest.TestCase):
    def test_openai(self):
        self.assertEqual(providers._openai_stream_delta({"choices": [{"delta": {"content": "Hola"}}]}), "Hola")
        self.assertEqual(providers._openai_stream_delta({"choices": [{"delta": {"role": "assistant"}}]}), "")
        self.assertEqual(providers._openai_stream_delta({}), "")

    def test_google(self):
        obj = {"candidates": [{"content": {"parts": [{"text": "Ho"}, {"text": "la"}]}}]}
        self.assertEqual(providers._google_stream_delta(obj), "Hola")
        self.assertEqual(providers._google_stream_delta({"candidates": [{"content": {"parts": []}}]}), "")
        self.assertEqual(providers._google_stream_delta({}), "")

    def test_anthropic(self):
        obj = {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hola"}}
        self.assertEqual(providers._anthropic_stream_delta(obj), "Hola")
        self.assertEqual(providers._anthropic_stream_delta({"type": "message_start"}), "")


class TestBodies(unittest.TestCase):
    def test_openai_normal_vs_reasoning(self):
        normal = providers._openai_body("gpt-4o-mini", "hi", {"temperature": 0.4, "max_tokens": 100})
        self.assertEqual(normal["temperature"], 0.4)
        self.assertEqual(normal["max_tokens"], 100)
        reasoning = providers._openai_body("o4-mini", "hi", {"temperature": 0.4, "max_tokens": 256})
        self.assertEqual(reasoning["max_completion_tokens"], 256)
        self.assertNotIn("temperature", reasoning)

    def test_openai_json_mode_and_stream(self):
        b = providers._openai_stream_body("gpt-4o-mini", "hi", {"temperature": 0.4, "max_tokens": 100, "json_mode": True})
        self.assertTrue(b["stream"])
        self.assertEqual(b["response_format"], {"type": "json_object"})

    def test_google_gemma_no_mime(self):
        gemma = providers._google_body("gemma-4-31b-it", "hi", {"temperature": 0.4, "max_tokens": 100})
        self.assertNotIn("responseMimeType", gemma["generationConfig"])
        gemini = providers._google_body("gemini-3.5-flash", "hi", {"temperature": 0.4, "max_tokens": 100})
        self.assertIn("responseMimeType", gemini["generationConfig"])

    def test_anthropic_stream_flag(self):
        b = providers._anthropic_stream_body("claude-haiku-4-5", "hi", {"temperature": 0.4, "max_tokens": 100})
        self.assertTrue(b["stream"])


class TestResolveConfig(unittest.TestCase):
    def test_defaults(self):
        with clean_env():
            cfg = providers.resolve_ai_config({"ai": {"api_key": "k"}})
        self.assertEqual(cfg["provider"], "anthropic")
        self.assertEqual(cfg["max_tokens"], 8192)
        self.assertEqual(cfg["timeout"], 180.0)

    def test_timeout_from_profile_and_env(self):
        with clean_env():
            cfg = providers.resolve_ai_config({"ai": {"api_key": "k", "timeout": 300}})
        self.assertEqual(cfg["timeout"], 300.0)
        with clean_env(JOB_AI_TIMEOUT="450"):
            cfg = providers.resolve_ai_config({"ai": {"api_key": "k", "timeout": 300}})
        self.assertEqual(cfg["timeout"], 450.0)  # el entorno gana

    def test_google_json_mode_forced_false(self):
        with clean_env():
            cfg = providers.resolve_ai_config({"ai": {"provider": "google", "api_key": "k", "model": "gemma-4-31b-it", "json_mode": True}})
        self.assertFalse(cfg["json_mode"])

    def test_missing_model_raises(self):
        with clean_env():
            with self.assertRaises(providers.AIConfigError):
                providers.resolve_ai_config({"ai": {"provider": "custom", "base_url": "http://x"}})


class TestExtractJson(unittest.TestCase):
    def test_strips_fences(self):
        self.assertEqual(providers.extract_json_object('```json\n{"0":"a"}\n```'), {"0": "a"})
        self.assertEqual(providers.extract_json_object('texto {"1":"ok"} fin'), {"1": "ok"})

    def test_no_json_raises(self):
        with self.assertRaises(ValueError):
            providers.extract_json_object("no hay json aquí")


class _SSEHandler(BaseHTTPRequestHandler):
    words = ["Hola", " ", "mundo"]
    delay = 0.02

    def log_message(self, *a):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        try:
            for w in self.words:
                time.sleep(self.delay)
                self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {'content': w}}]})}\n\n".encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except BrokenPipeError:
            pass  # el cliente abortó (timeout de inactividad): esperado


class TestCallProviderStreaming(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), _SSEHandler)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def cfg(self, timeout=5.0):
        return {
            "P": providers.PROVIDERS["custom"], "api_key": "", "model": "test",
            "base_url": f"http://127.0.0.1:{self.port}", "temperature": 0.4,
            "max_tokens": 100, "json_mode": False, "timeout": timeout,
        }

    def test_accumulates_stream(self):
        _SSEHandler.delay = 0.02
        self.assertEqual(providers.call_provider(self.cfg(), "hola"), "Hola mundo")

    def test_inactivity_timeout(self):
        _SSEHandler.delay = 1.0  # el servidor calla > timeout entre tokens
        with self.assertRaises(httpx.ReadTimeout):
            providers.call_provider(self.cfg(timeout=0.3), "hola")


if __name__ == "__main__":
    unittest.main()
