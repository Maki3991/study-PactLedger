"""Fetch a real, bounded A-share recommendation universe from PandaData."""

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


def text(value: Any) -> str:
    if value is None:
        return ""
    normalized = str(value)
    return "" if normalized.lower() == "nan" else normalized


def number(value: Any) -> float | None:
    try:
        result = float(value)
        return result if result == result else None
    except (TypeError, ValueError):
        return None


def safe_error(error: Exception) -> str:
    message = re.sub(
        r"(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+",
        r"\1=[redacted]",
        str(error),
        flags=re.IGNORECASE,
    )
    return " ".join(message.split())[:160]


def source(method: str, status: str, count: int, note: str = "") -> dict[str, Any]:
    item: dict[str, Any] = {"method": method, "status": status, "recordCount": count}
    if note:
        item["note"] = note
    return item


def optional_frame(method: str, callback: Any) -> tuple[Any, dict[str, Any]]:
    try:
        frame = callback()
        count = 0 if frame is None else int(len(frame))
        return frame, source(method, "used" if count else "empty", count)
    except Exception as error:
        return None, source(method, "unavailable", 0, safe_error(error))


def compact_date(value: Any) -> str:
    return text(value).replace("-", "")[:8]


def returns_by_date(frame: Any) -> dict[str, float]:
    if frame is None or frame.empty:
        return {}
    ordered = frame.copy()
    ordered["_date"] = ordered["date"].apply(compact_date)
    ordered = ordered.sort_values("_date")
    result: dict[str, float] = {}
    previous = None
    for row in ordered.to_dict(orient="records"):
        close = number(row.get("close"))
        if close is not None and previous is not None and previous > 0:
            result[row["_date"]] = close / previous - 1
        if close is not None:
            previous = close
    return result


def period_return(frame: Any, lookback: int) -> float | None:
    if frame is None or frame.empty:
        return None
    ordered = frame.copy()
    ordered["_date"] = ordered["date"].apply(compact_date)
    ordered = ordered.sort_values("_date")
    closes = [number(value) for value in ordered["close"].tolist()]
    closes = [value for value in closes if value is not None and value > 0]
    return (closes[-1] / closes[-lookback - 1] - 1) * 100 if len(closes) > lookback else None


def beta(asset: dict[str, float], benchmark: dict[str, float]) -> float | None:
    aligned = [(value, benchmark[date]) for date, value in asset.items() if date in benchmark]
    if len(aligned) < 30:
        return None
    asset_values = [item[0] for item in aligned]
    benchmark_values = [item[1] for item in aligned]
    asset_mean = sum(asset_values) / len(asset_values)
    benchmark_mean = sum(benchmark_values) / len(benchmark_values)
    covariance = sum((a - asset_mean) * (b - benchmark_mean) for a, b in aligned) / len(aligned)
    variance = sum((b - benchmark_mean) ** 2 for b in benchmark_values) / len(benchmark_values)
    return covariance / variance if variance > 0 else None


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
        raise RuntimeError(f"Unsupported panda-data version {installed_version}; expected {REQUIRED_SDK_VERSION}")

    import panda_data

    panda_data.init_token(
        username=username,
        password=password,
        base_url=os.environ.get("PANDA_DATA_BASE_URL", "http://pandadata.pandaaiquant.com"),
    )
    benchmark = text(request.get("benchmarkSymbol")) or "000300.SH"
    weights = panda_data.get_index_weights(
        index_symbol=[benchmark],
        start_date=request["startDate"],
        end_date=request["endDate"],
        fields=[],
    )
    if weights is None or weights.empty:
        raise RuntimeError("PandaData get_index_weights returned no rows")
    weights = weights.copy()
    weights["_date"] = weights["date"].astype(str).str.replace("-", "", regex=False).str[:8]
    latest_date = weights["_date"].max()
    latest = weights[weights["_date"] == latest_date].copy()
    latest["_weight"] = latest["weight"].apply(lambda value: number(value) or 0)
    latest = latest.sort_values("_weight", ascending=False)
    candidate_limit = max(5, min(int(request.get("candidateLimit", 40)), 80))
    latest = latest.head(candidate_limit)
    symbols = [text(value) for value in latest["stock_symbol"].tolist() if text(value)]
    if not symbols:
        raise RuntimeError("PandaData index weights contained no stock symbols")

    details, detail_source = optional_frame(
        "get_stock_detail",
        lambda: panda_data.get_stock_detail(symbol=symbols, fields=[], status=1),
    )
    daily, daily_source = optional_frame(
        "get_stock_daily_pre",
        lambda: panda_data.get_stock_daily_pre(
            symbol=symbols,
            start_date=request["startDate"],
            end_date=request["endDate"],
            fields=[],
            indicator="",
            st=False,
        ),
    )
    benchmark_daily, benchmark_source = optional_frame(
        "get_index_daily",
        lambda: panda_data.get_index_daily(
            symbol=[benchmark],
            start_date=request["startDate"],
            end_date=request["endDate"],
            fields=[],
        ),
    )

    detail_by_symbol = {} if details is None else {
        text(row.get("symbol")): row for row in details.to_dict(orient="records")
    }
    benchmark_returns = returns_by_date(benchmark_daily)
    benchmark_return_13w = period_return(benchmark_daily, 60)
    benchmark_return_26w = period_return(benchmark_daily, 120)

    candidates = []
    for row in latest.to_dict(orient="records"):
        symbol = text(row.get("stock_symbol"))
        stock_daily = None if daily is None else daily[daily["symbol"].astype(str) == symbol].copy()
        if stock_daily is None or len(stock_daily) < 60:
            continue
        detail = detail_by_symbol.get(symbol, {})
        stock_daily["_date"] = stock_daily["date"].apply(compact_date)
        stock_daily = stock_daily.sort_values("_date")
        rows = stock_daily.to_dict(orient="records")
        closes = [number(item.get("close")) for item in rows]
        closes = [value for value in closes if value is not None and value > 0]
        if len(closes) < 60:
            continue
        latest_row = rows[-1]
        asset_return_13w = (closes[-1] / closes[-61] - 1) * 100 if len(closes) > 60 else None
        asset_return_26w = (closes[-1] / closes[-121] - 1) * 100 if len(closes) > 120 else None
        rel13 = asset_return_13w - benchmark_return_13w if asset_return_13w is not None and benchmark_return_13w is not None else None
        rel26 = asset_return_26w - benchmark_return_26w if asset_return_26w is not None and benchmark_return_26w is not None else None
        recent = rows[-60:]
        turnover = [
            (number(item.get("close")) or 0) * (number(item.get("volume")) or 0)
            for item in recent
        ]
        candidates.append(
            {
                "symbol": symbol,
                "name": text(detail.get("name")) or text(latest_row.get("name")) or symbol,
                "indexWeight": number(row.get("weight")),
                "close": closes[-1],
                "closeDate": compact_date(latest_row.get("date")),
                "relativeReturn13w": rel13,
                "relativeReturn26w": rel26,
                "beta": beta(returns_by_date(stock_daily), benchmark_returns),
                "averageDailyValue3m": sum(turnover) / len(turnover) if turnover else None,
            }
        )

    emit(
        {
            "universeSize": len(latest),
            "candidates": candidates,
            "sources": [
                source("get_index_weights", "used", len(latest), f"{benchmark} · {latest_date}"),
                detail_source,
                daily_source,
                benchmark_source,
            ],
        }
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"error": safe_error(error)})
        raise SystemExit(1)
