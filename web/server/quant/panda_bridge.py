"""Minimal JSON bridge around PandaData's Python SDK.

Credentials are read only from environment variables. The Node process sends a
query through stdin and receives one JSON object on stdout.
"""

from __future__ import annotations

import json
import os
import re
import sys
from importlib.metadata import PackageNotFoundError, version
from typing import Any


REQUIRED_SDK_VERSION = "0.0.12"


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def normalize_date(value: Any) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    if text.endswith(".0"):
        text = text[:-2]
    return text.replace("-", "")[:8]


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    return "" if text.lower() == "nan" else text


def normalize_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
        return number if number == number else None
    except (TypeError, ValueError):
        return None


def safe_error(error: Exception) -> str:
    message = re.sub(r"://[^@\s]+@", "://[redacted]@", str(error))
    message = re.sub(
        r"(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+",
        r"\1=[redacted]",
        message,
        flags=re.IGNORECASE,
    )
    return " ".join(message.split())[:160]


def source_evidence(method: str, status: str, count: int, note: str = "") -> dict[str, Any]:
    evidence: dict[str, Any] = {
        "method": method,
        "status": status,
        "recordCount": count,
    }
    if note:
        evidence["note"] = note
    return evidence


def optional_frame(method: str, callback: Any) -> tuple[Any, dict[str, Any]]:
    try:
        frame = callback()
        count = 0 if frame is None else int(len(frame))
        return frame, source_evidence(method, "used" if count else "empty", count)
    except Exception as error:
        return None, source_evidence(method, "unavailable", 0, safe_error(error))


def frame_to_bars(frame: Any) -> list[dict[str, Any]]:
    if frame is None or frame.empty:
        return []
    bars = []
    for row in frame.to_dict(orient="records"):
        close = normalize_number(row.get("close"))
        if close is None:
            continue
        bars.append(
            {
                "date": normalize_date(row.get("date", "")),
                "close": close,
                "volume": normalize_number(row.get("volume")) or 0,
            }
        )
    bars.sort(key=lambda item: item["date"])
    return bars


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
    benchmark_symbol = normalize_text(request.get("benchmarkSymbol")) or "000300.SH"
    frame = panda_data.get_stock_daily_pre(
        symbol=[request["symbol"]],
        start_date=request["startDate"],
        end_date=request["endDate"],
        fields=[],
        indicator=request.get("indicator", benchmark_symbol.split(".")[0]),
        st=True,
    )
    if frame is None or frame.empty:
        raise RuntimeError("PandaData returned no rows for the requested symbol and period")

    bars = frame_to_bars(frame)
    sources = [source_evidence("get_stock_daily_pre", "used", len(bars))]

    detail_frame, detail_source = optional_frame(
        "get_stock_detail",
        lambda: panda_data.get_stock_detail(symbol=[request["symbol"]], fields=[], status=None),
    )
    sources.append(detail_source)
    stock_profile = None
    if detail_frame is not None and not detail_frame.empty:
        row = detail_frame.iloc[0].to_dict()
        stock_profile = {
            "symbol": normalize_text(row.get("symbol")) or request["symbol"],
            "name": normalize_text(row.get("name")),
            "status": normalize_number(row.get("status")),
            "boardType": normalize_text(row.get("board_type")),
            "specialType": normalize_text(row.get("special_type")),
            "listedDate": normalize_date(row.get("listed_date", "")),
            "deListedDate": normalize_date(row.get("de_listed_date", "")),
            "minOrderAmount": normalize_number(row.get("min_order_amount")),
        }

    industry_frame, industry_source = optional_frame(
        "get_stock_industry",
        lambda: panda_data.get_stock_industry(stock_symbol=request["symbol"], level="L1"),
    )
    sources.append(industry_source)
    industry = None
    if industry_frame is not None and not industry_frame.empty:
        row = industry_frame.iloc[0].to_dict()
        industry = {
            "code": normalize_text(row.get("industry_code")),
            "name": normalize_text(row.get("industry_name")),
            "level": "L1",
        }

    benchmark_frame, benchmark_source = optional_frame(
        "get_index_daily",
        lambda: panda_data.get_index_daily(
            symbol=[benchmark_symbol],
            start_date=request["startDate"],
            end_date=request["endDate"],
            fields=[],
        ),
    )
    benchmark_bars = frame_to_bars(benchmark_frame)
    benchmark_source["recordCount"] = len(benchmark_bars)
    if benchmark_source["status"] == "used" and not benchmark_bars:
        benchmark_source["status"] = "empty"
    sources.append(benchmark_source)

    emit(
        {
            "bars": bars,
            "stockProfile": stock_profile,
            "industry": industry,
            "benchmark": {"symbol": benchmark_symbol, "bars": benchmark_bars},
            "sources": sources,
        }
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # The caller converts this to a typed provider error.
        emit({"error": str(error)})
        raise SystemExit(1)
