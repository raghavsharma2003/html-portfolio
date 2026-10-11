"""Offline transport controls. No Azure, GPU, database or model calls."""
import importlib.util
import json
import os
from pathlib import Path
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import httpx

spec = importlib.util.spec_from_file_location('broker53', Path(__file__).with_name('broker.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class AdmissionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {
            'OPEN_VOICE_ALLOCATION_ORIGIN': 'https://cpu.example.azurecontainerapps.io',
            'OPEN_VOICE_BROKER_ORIGIN': 'https://broker.example.azurecontainerapps.io'})
        self.env.start()
        b.app.state.secret = b'x' * 32
        b.app.state.runtime_origin = 'https://gpu.internal.example.azurecontainerapps.io'
        b.app.state.seen_nonces = {}
        self.mode = 'ok'
        self.gpu_mode = 'ok'
        self.calls = []
        self.children = set()
        self.clients = []
        for name, handler in [('admission_client', self.admission), ('wake_client', self.gpu), ('runtime_client', self.gpu)]:
            client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
            self.clients.append(client)
            setattr(b.app.state, name, client)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=b.app), base_url='https://broker.example.azurecontainerapps.io')

    async def asyncTearDown(self):
        await self.client.aclose()
        for client in self.clients:
            await client.aclose()
        self.env.stop()

    def admission(self, request):
        self.calls.append('admission')
        payload = json.loads(request.content)
        self.assertEqual(request.url.path, b.ALLOCATION_PATH)
        self.assertEqual(payload['runtime_origin'], b.app.state.runtime_origin)
        self.assertEqual(payload['broker_origin'], os.environ['OPEN_VOICE_BROKER_ORIGIN'])
        headers = request.headers
        self.assertEqual(headers['x-vyakti-content-sha256'], b._sha(request.content))
        self.assertEqual(headers['x-vyakti-signature'], b._signature(b.app.state.secret, (
            b.PROTOCOL, 'POST', b.ALLOCATION_PATH, headers['x-vyakti-timestamp'], headers['x-vyakti-nonce'], b._sha(request.content))))
        if self.mode == 'timeout':
            raise httpx.ReadTimeout('private details')
        value = {k: payload[k] for k in ['window_id', 'child_id', 'operation', 'body_sha256']}
        value['authorized'] = True
        value['dispatch_not_after'] = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat().replace('+00:00', 'Z')
        if self.mode == 'expired':
            value['dispatch_not_after'] = '2020-01-01T00:00:00Z'
        if self.mode == 'far_future':
            value['dispatch_not_after'] = '2999-01-01T00:00:00Z'
        if self.mode == 'invalid_deadline':
            value['dispatch_not_after'] = 'Infinity'
        status = 200
        if payload['child_id'] in self.children or self.mode == 'denied':
            status = 403
        self.children.add(payload['child_id'])
        if self.mode == 'mismatch':
            value['operation'] = 'other'
        if self.mode == 'false':
            value['authorized'] = False
        body = json.dumps(value).encode()
        if self.mode in ('oversize', 'chunked_oversize'):
            body = b'x' * 4097
        if self.mode == 'redirect':
            status = 307
        signature = b._signature(b.app.state.secret, (b.PROTOCOL, 'response', b.ALLOCATION_PATH, headers['x-vyakti-nonce'], str(status), b._sha(body)))
        if self.mode == 'bad_signature':
            signature = 'bad'
        response_headers = {'x-vyakti-response-signature': signature, 'location': 'https://untrusted.invalid'}
        if self.mode == 'chunked_oversize':
            return httpx.Response(status, headers=response_headers, stream=httpx.ByteStream(body))
        return httpx.Response(status, content=body, headers=response_headers)

    def gpu(self, request):
        self.calls.append(request.method + ' ' + request.url.path)
        body = b'{"ready":true}' if request.method == 'GET' else b'{"audio":"synthetic-test"}'
        status = 200
        if self.gpu_mode == 'error':
            body = b'{"error":"private upstream detail"}'
            status = 500
        if self.gpu_mode == 'redirect':
            status = 307
        signature = b._signature(b.app.state.secret, (b.PROTOCOL, 'response', b.PATH, request.headers.get('x-vyakti-nonce', ''), str(status), b._sha(body)))
        return httpx.Response(status, content=body, headers={'x-vyakti-response-signature': signature})

    async def send(self, path=b.PATH, ids=True, body=None):
        body = body or (b'{"op":"runtime_status"}' if path == b.RUNTIME_STATUS_PATH else b'{"test":true}')
        headers, _ = b._internal_headers(b._sha(body), path)
        if ids:
            headers.update({'x-vyakti-allocation-window': '11111111-1111-4111-8111-111111111111', 'x-vyakti-allocation-child': '22222222-2222-4222-8222-222222222222'})
        return await self.client.post(path, content=body, headers=headers)

    async def test_synthesis_consumes_before_exactly_one_gpu_call(self):
        self.assertEqual((await self.send()).status_code, 200)
        self.assertEqual(self.calls, ['admission', 'POST /v1/synthesize'])

    async def test_status_consumes_before_exactly_one_gpu_call(self):
        self.assertEqual((await self.send(b.RUNTIME_STATUS_PATH)).status_code, 200)
        self.assertEqual(self.calls, ['admission', 'GET /healthz'])

    async def test_missing_ids_no_callback_or_gpu(self):
        self.assertEqual((await self.send(ids=False)).status_code, 403)
        self.assertEqual(self.calls, [])

    async def test_missing_config_no_callback_or_gpu(self):
        del os.environ['OPEN_VOICE_ALLOCATION_ORIGIN']
        self.assertEqual((await self.send()).status_code, 503)
        self.assertEqual(self.calls, [])

    async def test_non_azure_callback_no_gpu(self):
        os.environ['OPEN_VOICE_ALLOCATION_ORIGIN'] = 'https://arbitrary.invalid'
        self.assertEqual((await self.send()).status_code, 503)
        self.assertEqual(self.calls, [])

    async def test_admission_failures_never_reach_gpu(self):
        for mode in ['timeout', 'denied', 'mismatch', 'false', 'oversize', 'chunked_oversize', 'redirect', 'bad_signature', 'expired', 'far_future', 'invalid_deadline']:
            for path in [b.PATH, b.RUNTIME_STATUS_PATH]:
                with self.subTest(mode=mode, path=path):
                    self.mode = mode
                    self.calls.clear()
                    self.children.clear()
                    response = await self.send(path)
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json()['error'], 'voice_allocation_admission_denied')
                    self.assertEqual(self.calls, ['admission'])

    async def test_child_replay_denied_by_callback_even_with_new_transport_nonce(self):
        await self.send()
        self.calls.clear()
        self.assertEqual((await self.send()).status_code, 503)
        self.assertEqual(self.calls, ['admission'])

    async def test_invalid_status_not_consumed(self):
        self.assertEqual((await self.send(b.RUNTIME_STATUS_PATH, body=b'{"op":"wrong"}')).status_code, 400)
        self.assertEqual(self.calls, [])

    async def test_upstream_failure_is_sanitized_and_never_retried(self):
        for mode in ['error', 'redirect']:
            with self.subTest(mode=mode):
                self.gpu_mode = mode
                self.calls.clear()
                self.children.clear()
                response = await self.send()
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('private upstream detail', response.text)
                self.assertEqual(self.calls, ['admission', 'POST /v1/synthesize'])

    async def test_expired_between_admission_and_forward_has_no_gpu_call(self):
        original = b._require_allocation_authority
        async def consume_then_expire(request, body_hash):
            await original(request, body_hash)
            return 1.0
        with patch.object(b, '_require_allocation_authority', consume_then_expire):
            for path in [b.PATH, b.RUNTIME_STATUS_PATH]:
                self.calls.clear()
                self.children.clear()
                self.assertEqual((await self.send(path)).status_code, 503)
                self.assertEqual(self.calls, ['admission'])

    async def test_unsigned_request_no_callback_or_gpu(self):
        response = await self.client.post(b.PATH, content=b'{}')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.calls, [])

if __name__ == '__main__':
    unittest.main()
