"""Prompt-learning provider backed by Twyne's existing metered DPoP client.

Only prompts/results cross stdin/stdout. Signing keys stay in the inherited
process environment. No HTTP listener or direct upstream credentials are used.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import subprocess

REPO_ROOT = Path(__file__).resolve().parents[1]


class NotOrganicOptimizerProvider:
    def __init__(self, budget_usd: float):
        try:
            ceiling = os.environ.get("TWYNE_EVAL_MAX_COST_MICROUSD", "")
            if not ceiling.isascii() or not ceiling.isdecimal() or ceiling.startswith("0"):
                raise ValueError("TWYNE_EVAL_MAX_COST_MICROUSD must be a positive integer")
            self.per_call = int(ceiling)
            budget = Decimal(str(budget_usd)) * 1_000_000
            if not budget.is_finite() or budget <= 0 or budget != budget.to_integral_value():
                raise ValueError("--budget must be positive USD with at most six decimals")
            self.remaining = int(budget)
            if self.per_call > 2**53 - 1:
                raise ValueError("Per-call ceiling is too large")
        except InvalidOperation as exc:
            raise ValueError("Invalid optimization budget") from exc
        self.failures: list[str] = []
        self.calls = 0

    def _invoke(self, body=None):
        command = ["bun", "run", str(REPO_ROOT / "evals" / "notorganic-chat.ts")]
        if body is None:
            command.append("--check")
        result = subprocess.run(
            command,
            input=json.dumps(body) if body is not None else None,
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=190,
            check=False,
        )
        if result.returncode:
            # Do not echo raw stderr: environment credentials must stay private.
            raise RuntimeError("Not Organic request failed; verify signing configuration and account access")
        return json.loads(result.stdout)

    def check(self):
        self._invoke()

    async def generate_text(self, messages, model, **kwargs):
        try:
            if model not in {"fast", "balanced", "reasoning"}:
                raise ValueError("Optimization model must be a Not Organic text alias")
            if self.per_call > self.remaining:
                raise RuntimeError("Optimization budget exhausted before next request")
            # Reserve the full approved ceiling, including requests with uncertain
            # outcomes. This is a conservative run cap, never an estimated price.
            self.remaining -= self.per_call
            self.calls += 1
            result = self._invoke({"model": model, "messages": messages, "temperature": 0.4})
            if not isinstance(result.get("content"), str):
                raise RuntimeError("Not Organic returned no optimization text")
            return result["content"]
        except Exception as exc:
            self.failures.append(type(exc).__name__)
            raise
