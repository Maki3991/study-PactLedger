import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


artifacts = Path(__file__).parent / "artifacts"
artifacts.mkdir(exist_ok=True)
base_url = os.environ.get("SMOKE_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
username = f"smoke_{int(time.time())}"
password = "smoke-pass-123"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors: list[str] = []

    landing = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    landing.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    landing.goto(f"{base_url}/", wait_until="networkidle")
    landing.get_by_role("heading", name="Agent 时代的财务系统").wait_for()
    landing.get_by_role("link", name="进入 KaleidoX 控制台").first.click()
    landing.wait_for_url(f"{base_url}/kaleidox.html")

    landing.get_by_role("tab", name="注册").click()
    landing.get_by_placeholder("3-24 位字母、数字或下划线").fill(username)
    landing.get_by_placeholder("至少 6 位").fill(password)
    landing.get_by_placeholder("再次输入密码").fill(password)
    landing.get_by_role("button", name="注册并登录").click()
    landing.get_by_role("heading", name="Agent Treasury 控制基座").wait_for()
    assert username in landing.locator(".profile-row").inner_text()
    landing.screenshot(path=str(artifacts / "desktop.png"), full_page=True)

    poolmate = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    poolmate.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    poolmate.goto(f"{base_url}/poolmate.html", wait_until="networkidle")
    poolmate.get_by_role("heading", name="PoolMate.").wait_for()
    assert poolmate.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    poolmate.screenshot(path=str(artifacts / "poolmate-mobile.png"), full_page=True)

    browser.close()
    if errors:
        raise AssertionError(f"Browser console errors: {errors}")

print("Landing, product login, and PoolMate smoke checks passed")
