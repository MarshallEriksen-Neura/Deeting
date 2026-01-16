#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _default_train_path() -> Path:
    return Path(__file__).resolve().parent / "data" / "fact_train.txt"


def _default_output_prefix() -> Path:
    return Path(__file__).resolve().parents[1] / "app" / "data" / "fact_classifier"


def main() -> int:
    parser = argparse.ArgumentParser(description="Train fastText classifier for user memory persistence.")
    parser.add_argument(
        "--train",
        type=Path,
        default=_default_train_path(),
        help="Path to fastText training file.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=_default_output_prefix(),
        help="Output prefix (without .bin).",
    )
    parser.add_argument("--epoch", type=int, default=25)
    parser.add_argument("--lr", type=float, default=0.5)
    parser.add_argument("--dim", type=int, default=50)
    parser.add_argument("--word-ngrams", type=int, default=2, dest="word_ngrams")
    parser.add_argument("--min-count", type=int, default=1, dest="min_count")

    args = parser.parse_args()
    train_path = args.train.expanduser().resolve()
    if not train_path.exists():
        print(f"Training file not found: {train_path}", file=sys.stderr)
        return 1

    try:
        import fasttext  # type: ignore
    except Exception as exc:  # pragma: no cover
        print(f"fasttext is not installed: {exc}", file=sys.stderr)
        return 1

    output_prefix = args.output.expanduser().resolve()
    output_prefix.parent.mkdir(parents=True, exist_ok=True)

    model = fasttext.train_supervised(
        input=str(train_path),
        epoch=args.epoch,
        lr=args.lr,
        dim=args.dim,
        wordNgrams=args.word_ngrams,
        minCount=args.min_count,
    )
    model.save_model(str(output_prefix) + ".bin")
    print(f"Saved model: {output_prefix}.bin")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
