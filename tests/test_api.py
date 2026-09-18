import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.api import app

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["dataset"], "synthetic")

    def test_request_validation(self):
        for body in [{"query": ""}, {"query": "补货", "storeId": "bad"}, {"query": "补货", "unexpected": 1}, {"query": "x"*501}]:
            self.assertEqual(self.client.post("/api/run", json=body).status_code, 422)

    @patch("backend.api.save")
    def test_report_contract_and_persistence(self, save):
        response = self.client.post("/api/run", json={"query": "分析销售并给出补货建议", "storeId": "GZ001"})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertTrue(result["review"]["passed"])
        self.assertEqual(result["mode"], "python")
        save.assert_called_once()
        self.assertIn("metrics", result)

    def test_query_limits(self):
        self.assertEqual(self.client.get("/api/knowledge", params={"q": "x"*501}).status_code, 400)
        self.assertEqual(self.client.get("/api/runs", params={"storeId": "bad"}).status_code, 422)

    def test_evaluation(self):
        response = self.client.post("/api/evaluate")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 32)

if __name__ == "__main__":
    unittest.main()
