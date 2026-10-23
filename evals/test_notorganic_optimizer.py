import asyncio
import json
import os
import subprocess
import unittest
from unittest.mock import patch

from notorganic_optimizer import NotOrganicOptimizerProvider


class OptimizerProviderTest(unittest.TestCase):
    def provider(self, budget=0.02):
        with patch.dict(os.environ, {"TWYNE_EVAL_MAX_COST_MICROUSD": "10000"}):
            return NotOrganicOptimizerProvider(budget)

    def test_reserves_full_ceiling_before_each_call_and_stops_at_run_budget(self):
        provider = self.provider()
        with patch.object(provider, "_invoke", return_value={"content": "revised"}) as invoke:
            self.assertEqual(asyncio.run(provider.generate_text([], "reasoning")), "revised")
            asyncio.run(provider.generate_text([], "reasoning"))
            with self.assertRaisesRegex(RuntimeError, "budget exhausted"):
                asyncio.run(provider.generate_text([], "reasoning"))
            self.assertEqual(invoke.call_count, 2)
            self.assertEqual(provider.remaining, 0)
            self.assertEqual(len(provider.failures), 1)

    def test_uncertain_failed_request_keeps_reservation(self):
        provider = self.provider()
        with patch.object(provider, "_invoke", side_effect=RuntimeError("failure")):
            with self.assertRaises(RuntimeError):
                asyncio.run(provider.generate_text([], "balanced"))
        self.assertEqual(provider.remaining, 10000)
        self.assertEqual(provider.calls, 1)
        self.assertTrue(provider.failures)

    def test_invalid_budgets_and_upstream_model_are_rejected(self):
        for value in [0, -1, float("inf"), float("nan"), 0.0000001]:
            with self.assertRaises(ValueError):
                self.provider(value)
        for value in ["", "0", "1.5", "-10", "9007199254740992"]:
            with patch.dict(os.environ, {"TWYNE_EVAL_MAX_COST_MICROUSD": value}):
                with self.assertRaises(ValueError):
                    NotOrganicOptimizerProvider(1)
        provider = self.provider()
        with patch.object(provider, "_invoke") as invoke:
            with self.assertRaises(ValueError):
                asyncio.run(provider.generate_text([], "upstream-model"))
            invoke.assert_not_called()

    def test_subprocess_uses_stdin_and_never_relays_raw_errors(self):
        provider = self.provider()
        response = subprocess.CompletedProcess([], 0, json.dumps({"content": "ok"}), "")
        with patch("notorganic_optimizer.subprocess.run", return_value=response) as run:
            self.assertEqual(asyncio.run(provider.generate_text([{"role": "user", "content": "prompt"}], "balanced")), "ok")
            args, kwargs = run.call_args
            self.assertEqual(args[0][:2], ["bun", "run"])
            self.assertEqual(json.loads(kwargs["input"])["model"], "balanced")
            self.assertNotIn("prompt", " ".join(args[0]))
            self.assertEqual(kwargs["timeout"], 190)
        response.returncode = 1
        response.stderr = "sensitive detail"
        with patch("notorganic_optimizer.subprocess.run", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "^Not Organic request failed;") as caught:
                provider.check()
            self.assertNotIn("sensitive", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
