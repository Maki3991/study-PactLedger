import time
from pathlib import Path
from playwright.sync_api import sync_playwright


artifacts = Path(__file__).parent / "artifacts"
artifacts.mkdir(exist_ok=True)

USERNAME = f"smoke_{int(time.time())}"
PASSWORD = "smoke-pass-123"


def register(page, username: str, password: str) -> None:
    """通过注册界面创建账户并进入工作台。"""
    page.get_by_role("tab", name="注册").click()
    page.get_by_placeholder("3-24 位字母、数字或下划线").fill(username)
    page.get_by_placeholder("至少 6 位").fill(password)
    page.get_by_placeholder("再次输入密码").fill(password)
    page.get_by_role("button", name="注册并登录").click()
    page.get_by_role("heading", name="ETH 策略进化任务").wait_for()


def login(page, username: str, password: str) -> None:
    """使用已有账户登录并进入工作台。"""
    page.get_by_placeholder("3-24 位字母、数字或下划线").fill(username)
    page.get_by_placeholder("至少 6 位").fill(password)
    page.get_by_role("button", name="登录").click()
    page.get_by_role("heading", name="ETH 策略进化任务").wait_for()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors: list[str] = []

    desktop = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    desktop.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    desktop.goto("http://127.0.0.1:5173", wait_until="networkidle")
    register(desktop, USERNAME, PASSWORD)
    assert USERNAME in desktop.locator(".profile-row").inner_text()
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
    login(mobile, USERNAME, PASSWORD)
    mobile.get_by_title("打开导航").click()
    assert mobile.locator(".sidebar").evaluate("element => element.classList.contains('open')")
    mobile.get_by_role("link", name="记忆库").click()
    assert not mobile.locator(".sidebar").evaluate("element => element.classList.contains('open')")
    mobile.wait_for_timeout(300)
    assert mobile.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    mobile.screenshot(path=str(artifacts / "mobile.png"), full_page=True)

    browser.close()

    if errors:
        raise AssertionError(f"Browser console errors: {errors}")

print("Desktop and mobile smoke checks passed")
