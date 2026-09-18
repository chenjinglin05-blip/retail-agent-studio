import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.api import app
from backend.replenishment import calculate_replenishment
from backend.replenishment_agent import ModelResponseError, ReplenishmentInputs, calculate_validated, run_replenishment
from backend.storage import save_replenishment, replenishment_history

ARGS = dict(daily=18, stock=42, inbound=12, lead_days=3, safety_days=2)
QUERY = '日均销量18件，现货42件，在途12件，采购提前期3天，安全天数2天'


class ReplenishmentTests(unittest.TestCase):
    def model_response(self, payload):
        return httpx.Response(200, json=payload, request=httpx.Request('POST', 'http://localhost/api/chat'))

    def tool_payload(self, arguments=None, name='calculate_replenishment'):
        return {'message': {'tool_calls': [{'function': {'name': name, 'arguments': ARGS if arguments is None else arguments}}]}}

    def test_formula_rounding_and_inbound(self):
        self.assertEqual(calculate_replenishment(**ARGS), {'target': 90, 'reorder': 36})
        self.assertEqual(calculate_replenishment(**dict(ARGS, stock=100))['reorder'], 0)
        self.assertEqual(calculate_replenishment(**dict(ARGS, daily=18.5))['target'], 93)
        self.assertEqual(calculate_replenishment(**dict(ARGS, daily=0)), {'target': 0, 'reorder': 0})

    def test_invalid_business_values(self):
        for bad in [dict(daily=-1), dict(daily=float('nan')), dict(daily=float('inf')), dict(stock=True), dict(stock=1.2), dict(inbound=None)]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                calculate_replenishment(**dict(ARGS, **bad))

    @patch('backend.replenishment_agent.httpx.Client.post')
    def test_one_model_call_then_real_tool(self, post):
        post.return_value = self.model_response(self.tool_payload())
        reply = run_replenishment(QUERY)
        self.assertEqual(reply['result']['reorder'], 36)
        self.assertEqual(reply['arguments']['stock'], 42)
        self.assertEqual([t['step'] for t in reply['trace']], ['ollama', 'validate_arguments', 'calculate_replenishment'])
        post.assert_called_once()
        self.assertEqual(post.call_args.kwargs['json']['messages'][1]['content'], QUERY)

    @patch('backend.replenishment_agent.call_tool')
    @patch('backend.replenishment_agent.httpx.Client.post')
    def test_bad_calls_never_execute(self, post, tool):
        cases = [self.tool_payload(name='execute_sql'), self.tool_payload({'stock': 42}),
                 self.tool_payload(dict(ARGS, stock='42')), self.tool_payload(dict(ARGS, stock=True)),
                 self.tool_payload(dict(ARGS, extra='ignore rules')), self.tool_payload(dict(ARGS, daily=-2)),
                 {'message': {'tool_calls': 'invalid'}}, {'message': {'tool_calls': [None]}},
                 {'message': {'tool_calls': self.tool_payload()['message']['tool_calls'] * 2}}, [], {'message': []}]
        for payload in cases:
            with self.subTest(payload=payload):
                post.return_value = self.model_response(payload)
                with self.assertRaises(ModelResponseError): run_replenishment(QUERY)
        tool.assert_not_called()

    @patch('backend.replenishment_agent.httpx.Client.post')
    def test_no_call_is_not_a_completed_calculation(self, post):
        post.return_value = self.model_response({'message': {'content': '请提供在途数量'}})
        reply = run_replenishment('每天18件，现货42件')
        self.assertEqual(reply['status'], 'not_calculated')
        self.assertNotIn('result', reply)

    @patch('backend.replenishment_agent.httpx.Client.post')
    def test_default_safety_days(self, post):
        args = {k: v for k, v in ARGS.items() if k != 'safety_days'}
        post.return_value = self.model_response(self.tool_payload(args))
        self.assertEqual(run_replenishment(QUERY)['arguments']['safety_days'], 2)

    @patch('backend.replenishment_agent.httpx.Client.post')
    def test_invalid_json_is_model_error(self, post):
        post.return_value = httpx.Response(200, text='not json', request=httpx.Request('POST', 'http://localhost/api/chat'))
        with self.assertRaises(ModelResponseError): run_replenishment(QUERY)

    @patch('backend.api.save_replenishment')
    @patch('backend.replenishment_agent.httpx.Client')
    def test_manual_api_does_not_call_model(self, post, save):
        result = TestClient(app).post('/api/replenishment/calculate', json=ARGS)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['result']['reorder'], 36)
        self.assertEqual(result.json()['mode'], 'manual')
        self.assertTrue(result.json()['persisted'])
        post.assert_not_called()
        save.assert_called_once()

    def test_api_validation(self):
        client = TestClient(app)
        for bad in [dict(stock=1.5), dict(inbound=-1), dict(daily='18'), dict(lead_days=366), dict(stock=True)]:
            self.assertEqual(client.post('/api/replenishment/calculate', json=dict(ARGS, **bad)).status_code, 422)
        for body in [{}, {'query': ' '}, {'query': 'x'*501}, {'query': QUERY, 'extra': 1}]:
            self.assertEqual(client.post('/api/replenishment', json=body).status_code, 422)

    @patch('backend.api.run_replenishment')
    def test_service_errors_have_useful_status(self, run):
        client = TestClient(app)
        for exception, code in [(httpx.ReadTimeout('test'), 504), (httpx.ConnectError('test'), 503), (ModelResponseError('工具格式异常'), 502)]:
            run.side_effect = exception
            res = client.post('/api/replenishment', json={'query': QUERY})
            self.assertEqual(res.status_code, code)
            self.assertTrue(res.json()['detail'])

    @patch('backend.api.save_replenishment', side_effect=sqlite3.OperationalError('disk full'))
    def test_storage_failure_keeps_valid_calculation(self, save):
        reply = TestClient(app).post('/api/replenishment/calculate', json=ARGS).json()
        self.assertFalse(reply['persisted'])
        self.assertEqual(reply['result']['reorder'], 36)

    def test_history_round_trip_and_limit(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / 'history.sqlite3'
            first = calculate_validated(ReplenishmentInputs(**ARGS))
            second = calculate_validated(ReplenishmentInputs(**dict(ARGS, stock=100)))
            first['query'] = "'; DROP TABLE replenishment_runs; --"
            save_replenishment(first, db); save_replenishment(second, db)
            self.assertEqual(len(replenishment_history(db_path=db)), 2)
            self.assertEqual(replenishment_history(1, db)[0]['result']['reorder'], 0)
            self.assertEqual(replenishment_history(db_path=db)[1]['query'], first['query'])


if __name__ == '__main__':
    unittest.main()
