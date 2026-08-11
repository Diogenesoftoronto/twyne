#!/usr/bin/env python3
"""
Optimize one of Twyne's markdown prompt files using Arize's
`prompt-learning` SDK (vendored under tools/prompt-learning/, see
TOOLS_PATCHES.md for the local patches that extend the model allowlist
and route through our Portkey gateway).

Usage
-----
    python evals/optimize_prompts.py \\
        --prompt integrity-judge-system \\
        --csv   evals/datasets/integrity-judge.csv \\
        --model gpt-5

The `--prompt` arg is the basenames we use in `src/utils/prompts.ts`'s
`promptNames` map (no ".md" needed). The CSV must have at minimum:

    - the columns named by the templates in the prompt body, substituted with
      literal values (so the optimizer can re-render it),
    - an `output` column with the model's previous output (the thing to
      improve against),
    - a `feedback` column with natural-language feedback for each row
      (explanations work better than scalar scores for this SDK).

What it writes
--------------
The rewritten prompt is staged at `prompts/<basename>.md.new` next to the
existing file. We write to a sibling file (rather than overwriting in
place) so a human reads the diff and approves a swap with `mv`. The
front-matter `version:` is bumped and `lastOptimized:` is set to today's
UTC date.

Why a sibling .new file and not a PR branch: prompt-learning runs a
single linear Agent → Evaluator → Meta-Prompt loop, doesn't touch git,
and we want each iteration to be auditable. A script-side temp file
makes both cheap.
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import sys
from pathlib import Path

# Vendored SDK — added to sys.path so we don't `pip install` from a fork
REPO_ROOT = Path(__file__).resolve().parents[1]
SDK_ROOT = REPO_ROOT / "tools" / "prompt-learning"
sys.path.insert(0, str(SDK_ROOT))

import pandas as pd  # noqa: E402
from prompt_learning import PromptLearningOptimizer  # noqa: E402

PROMPTS_DIR = REPO_ROOT / "prompts"

FRONTMATTER_RE = re.compile(
    r"^---\n(?P<body>.*?)\n---\n?(?P<rest>.*)$", re.DOTALL
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--prompt",
        required=True,
        help="Prompt basename without extension (e.g. `integrity-judge-system`)",
    )
    p.add_argument(
        "--csv",
        required=True,
        type=Path,
        help="Path to a CSV with `output` and `feedback` columns at minimum",
    )
    p.add_argument(
        "--model",
        default="gpt-5",
        help="Model name to use for the meta-prompt optimizer (default: gpt-5)",
    )
    p.add_argument(
        "--budget",
        type=float,
        default=2.0,
        help="USD spend limit for the optimization run (default: $2.00)",
    )
    p.add_argument(
        "--output",
        type=Path,
        help="Where to write the new prompt (default: <name>.md.new next to the original)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Load + parse everything; skip the actual optimizer. Useful for plumbing tests.",
    )
    return p.parse_args()


def load_prompt(path: Path) -> tuple[str, str, str]:
    """Returns (frontmatter_text, frontmatter_dict, body_with_vars)."""
    raw = path.read_text(encoding="utf-8")
    m = FRONTMATTER_RE.match(raw)
    if not m:
        return "", {}, raw
    fm_block = m.group("body")
    body = m.group("rest")
    # Parse simple key: value pairs from the front-matter block.
    fm_dict: dict[str, str] = {}
    for line in fm_block.splitlines():
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        v = v.strip()
        # strip one pair of wrapping double or single quotes
        if len(v) >= 2 and (
            (v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")
        ):
            v = v[1:-1]
        fm_dict[k.strip()] = v
    return fm_block, fm_dict, body


def bump_frontmatter(
    fm_dict: dict[str, str], today: str, note: str
) -> str:
    """Re-render the front-matter block with `version` and `lastOptimized`
    fields updated. We add `version` only if it isn't already present;
    otherwise we bump it (1 → 1.1 → 1.2 …)."""
    cur = fm_dict.get("version", "1")
    # Bump semver-ish: "1" → "1.1", "1.1" → "1.2", "1.4" → "1.5".
    parts = cur.split(".")
    try:
        head = parts[0]
        minor = int(parts[1]) if len(parts) > 1 else 0
    except ValueError:
        head, minor = cur, 0
    new = f"{head}.{minor + 1}"
    fm_dict["version"] = new
    fm_dict["lastOptimized"] = today
    if note:
        fm_dict.setdefault("notes", note)
    lines = ["---"]
    for k, v in fm_dict.items():
        if k == "notes" and "\n" in v:
            # Multi-line notes: render as a block-scalar string
            lines.append(f"{k}: |")
            for ln in v.splitlines():
                lines.append(f"  {ln}")
        else:
            lines.append(f'{k}: "{v}"' if re.search(r"[\"':]", v) else f"{k}: {v}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def main() -> int:
    args = parse_args()

    prompt_path = PROMPTS_DIR / f"{args.prompt}.md"
    if not prompt_path.exists():
        print(f"error: {prompt_path} does not exist", file=sys.stderr)
        return 2
    fm_block, fm_dict, body = load_prompt(prompt_path)
    if "{var}" not in body and re.search(r"\{\w+\}", body) is None:
        print(
            f"warning: {args.prompt}.md has no {{{{var}}}} placeholders; "
            "prompt-learning still runs but the optimizer can only edit "
            "the static text. That can still be valuable for tone/system "
            "prompts.",
            file=sys.stderr,
        )

    out_path = args.output or prompt_path.with_suffix(".md.new")

    dataset = pd.read_csv(args.csv)
    required = {"output", "feedback"}
    missing = required - set(dataset.columns)
    if missing:
        print(
            f"error: CSV is missing required columns {missing}; got {list(dataset.columns)}",
            file=sys.stderr,
        )
        return 2
    print(
        f"loaded {len(dataset)} rows from {args.csv} "
        f"(columns: {list(dataset.columns)})",
        file=sys.stderr,
    )

    if args.dry_run:
        print(
            f"dry-run ok — would optimize {prompt_path} with model={args.model} "
            f"budget=${args.budget} and write to {out_path}",
            file=sys.stderr,
        )
        return 0

    print(
        f"calling PromptLearningOptimizer(model={args.model}, budget=${args.budget}) …",
        file=sys.stderr,
    )
    optimizer = PromptLearningOptimizer(
        prompt=body,
        model_choice=args.model,
    )
    optimized = optimizer.optimize(
        dataset=dataset,
        output_column="output",
        feedback_columns=["feedback"],
        context_size_k=128,  # gpt-5 supports 128k and most modern models match
    )

    # The SDK returns either a string or a PromptVersion-shaped object;
    # normalise to a string so the .md has clean prose.
    if not isinstance(optimized, str):
        optimized = str(optimized)

    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    new_fm = bump_frontmatter(
        fm_dict,
        today=today,
        note=f"optimized via prompt-learning (model {args.model}, budget ${args.budget})",
    )
    out_path.write_text(new_fm + optimized.lstrip(), encoding="utf-8")

    print(
        f"\n✓ wrote {out_path}\n"
        f"  next step: git diff {prompt_path} {out_path}   then   "
        f"mv {out_path} {prompt_path}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
