"""Minimal JSON bridge around PandaData's Python SDK.

Credentials are read only from environment variables. The Node process sends a
query through stdin and receives one JSON object on stdout.
"""

from __future__ import annotations

import json
import os
import sys
from importlib.metadata import PackageNotFoundError, version
from typing import Any


REQUIRED_SDK_VERSION = "0.0.12"


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def normalize_date(value: Any) -> str:
    text = str(value)
    if text.endswith(".0"):
        text = text[:-2]
    return text.replace("-", "")[:8]


def main() -> None:
    request = json.load(sys.stdin)
    username = os.environ.get("PANDA_DATA_USERNAME", "").strip()
    password = os.environ.get("PANDA_DATA_PASSWORD", "").strip()
    if not username or not password:
        raise RuntimeError("PANDA_DATA_USERNAME and PANDA_DATA_PASSWORD are required")

    try:
        installed_version = version("panda-data")
    except PackageNotFoundError as error:
        raise RuntimeError("panda_data is not installed; expected panda-data==0.0.12") from error
    if installed_version != REQUIRED_SDK_VERSION:
        raise RuntimeError(
            f"Unsupported panda-data version {installed_version}; expected {REQUIRED_SDK_VERSION}"
        )

    import panda_data

    panda_data.init_token(
        username=username,
        password=password,
        base_url=os.environ.get("PANDA_DATA_BASE_URL", "http://pandadata.pandaaiquant.com"),
    )
    frame = panda_data.get_stock_daily_pre(
        symbol=[request["symbol"]],
        start_date=request["startDate"],
        end_date=request["endDate"],
        fields=[],
        indicator=request.get("indicator", "000300"),
        st=True,
    )
    if frame is None or frame.empty:
        raise RuntimeError("PandaData returned no rows for the requested symbol and period")

    records = frame.to_dict(orient="records")
    bars = []
    for row in records:
        close = row.get("close")
        if close is None:
            continue
        bars.append(
            {
                "date": normalize_date(row.get("date", "")),
                "close": float(close),
                "volume": float(row.get("volume") or 0),
            }
        )
    bars.sort(key=lambda item: item["date"])
    emit({"bars": bars})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # The caller converts this to a typed provider error.
        emit({"error": str(error)})
        raise SystemExit(1)
