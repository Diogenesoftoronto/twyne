"""Offline optimizer -> Bun subprocess -> signed/metered client integration.

Requires the vendored SDK's Python dependencies and Bun. Fetch is replaced in
an isolated child preload; this test never contacts a service or spends funds.
"""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import optimize_prompts

PRELOAD = '''
const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
process.env.NOTORGANIC_ENABLED = "true";
process.env.NOTORGANIC_ASSERTION_PRIVATE_KEY = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
process.env.NOTORGANIC_ISSUER = "https://offline.invalid";
process.env.TWYNE_EVAL_DID = "did:plc:offline-fixture";
process.env.TWYNE_EVAL_MAX_COST_MICROUSD = "10000";
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (!request.url.startsWith("https://offline.invalid/")) throw new Error("Unexpected network destination");
  if (request.url.endsWith("/exchange")) {
    const body = await request.json();
    const claims = JSON.parse(Buffer.from(body.assertion.split(".")[1], "base64url").toString());
    if (claims.sub !== "did:plc:offline-fixture" || claims.capabilities[0] !== "infer:reasoning") throw new Error("Bad scope");
    return Response.json({ access_token: "offline-token" });
  }
  if (!request.headers.get("dpop") || !request.headers.get("idempotency-key") || request.headers.get("x-notorganic-max-cost-microusd") !== "10000") throw new Error("Missing metering or proof");
  const body = await request.json();
  if (body.model !== "reasoning" || !body.messages[0].content.includes("feedback")) throw new Error("Bad optimizer payload");
  return Response.json({ choices: [{ message: { content: "A revised fixture prompt." } }] });
};
'''


class OptimizerPipelineTest(unittest.TestCase):
    def test_wrapper_stages_candidate_through_real_subprocess_and_dpop_client(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            preload = root / "offline-preload.ts"
            preload.write_text(PRELOAD)
            output = root / "candidate.md.new"
            args = argparse.Namespace(
                prompt="integrity-judge-system",
                csv=optimize_prompts.REPO_ROOT / "evals/datasets/_smoke.csv",
                model="reasoning", budget=0.02, output=output, dry_run=False,
            )
            real_run = subprocess.run

            def with_offline_fetch(command, **kwargs):
                return real_run([command[0], "run", "--preload", str(preload), *command[2:]], **kwargs)

            with patch.dict(os.environ, {"TWYNE_EVAL_MAX_COST_MICROUSD": "10000"}), \
                 patch.object(optimize_prompts, "parse_args", return_value=args), \
                 patch("notorganic_optimizer.subprocess.run", side_effect=with_offline_fetch):
                self.assertEqual(optimize_prompts.main(), 0)
            self.assertIn("A revised fixture prompt.", output.read_text())
            self.assertIn("lastOptimized:", output.read_text())

    def test_failed_batch_does_not_write_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "candidate.md.new"
            args = argparse.Namespace(
                prompt="integrity-judge-system",
                csv=optimize_prompts.REPO_ROOT / "evals/datasets/_smoke.csv",
                model="reasoning", budget=0.02, output=output, dry_run=False,
            )
            def fail_request(provider, body=None):
                if body is not None:
                    raise RuntimeError("offline provider denial")
                return {"ok": True}

            with patch.dict(os.environ, {"TWYNE_EVAL_MAX_COST_MICROUSD": "10000"}), \
                 patch.object(optimize_prompts, "parse_args", return_value=args), \
                 patch.object(optimize_prompts.NotOrganicOptimizerProvider, "_invoke", fail_request):
                with self.assertRaisesRegex(RuntimeError, "no prompt was written"):
                    optimize_prompts.main()
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
