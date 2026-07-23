from pathlib import Path
from playwright.sync_api import sync_playwright


artifacts = Path(__file__).parent / "artifacts"
artifacts.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors: list[str] = []

    desktop = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    desktop.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    desktop.goto("http://127.0.0.1:5173", wait_until="networkidle")
    desktop.get_by_role("heading", name="Agent Treasury 控制基座").wait_for()
    desktop.get_by_role("button", name="Injective Testnet").click()
    desktop.get_by_role("heading", name="Injective 测试网配置").wait_for()
    assert "web/.env.local" in desktop.get_by_role("dialog").inner_text()
    assert "INJECTIVE_PRIVATE_KEY" in desktop.get_by_role("dialog").inner_text()
    desktop.screenshot(path=str(artifacts / "injective-config.png"), full_page=True)
    desktop.get_by_title("关闭配置").click()
    desktop.get_by_role("button", name="启动演示").click()
    desktop.get_by_role("button", name="批准并执行 V2-B").wait_for(timeout=8_000)
    assert "25%" in desktop.locator(".firewall-rules").inner_text()
    desktop.get_by_role("button", name="V2-A Challenger").click()
    assert "增加波动率过滤" in desktop.locator(".selected-strategy-note").inner_text()
    desktop.get_by_role("button", name="批准并执行 V2-B").click()
    try:
        desktop.get_by_text("测试网执行成功").wait_for(timeout=5_000)
    except Exception:
        desktop.screenshot(path=str(artifacts / "execution-failure.png"), full_page=True)
        alert = desktop.locator(".api-error")
        print(f"Execution state: {desktop.locator('.primary-action').inner_text()}")
        print(f"API error: {alert.inner_text() if alert.count() else 'none'}")
        raise
    assert "0x8f7c" in desktop.locator(".execution-receipt").inner_text()
    desktop.screenshot(path=str(artifacts / "desktop.png"), full_page=True)

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    mobile.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    mobile.goto("http://127.0.0.1:5173", wait_until="networkidle")
    mobile.get_by_title("打开导航").click()
    assert mobile.locator(".sidebar").evaluate("element => element.classList.contains('open')")
    mobile.get_by_role("button", name="策略实验").click()
    assert not mobile.locator(".sidebar").evaluate("element => element.classList.contains('open')")
    mobile.wait_for_timeout(300)
    assert mobile.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    mobile.screenshot(path=str(artifacts / "mobile.png"), full_page=True)

    browser.close()

    if errors:
        raise AssertionError(f"Browser console errors: {errors}")

print("Desktop and mobile smoke checks passed")
