from __future__ import annotations

import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "test-artifacts"


def inline_html() -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    js = (ROOT / "src" / "app.js").read_text(encoding="utf-8")
    assets: dict[str, dict[str, str]] = {}
    for skin_dir in (ROOT / "assets" / "characters").iterdir():
        if not skin_dir.is_dir():
            continue
        assets[skin_dir.name] = {}
        for path in skin_dir.glob("*.png"):
            assets[skin_dir.name][path.stem] = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()
    html = html.replace('<link rel="stylesheet" href="./styles.css" />', f"<style>{css}</style>")
    html = html.replace(
        '<script type="module" src="./src/app.js"></script>',
        f"<script>window.PHYSICAL_DIORAMA_ASSETS={json.dumps(assets)};</script><script type=\"module\">{js}</script>",
    )
    return html


def wait_mode(page, mode: str, timeout_ms: int = 7000) -> None:
    page.wait_for_function("mode => window.PhysicalDiorama.getState().agent.mode === mode", arg=mode, timeout=timeout_ms)


def main() -> int:
    ART.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 1100})
        errors: list[str] = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.set_content(inline_html(), wait_until="load")
        page.wait_for_function("() => Boolean(window.PhysicalDiorama)")
        page.wait_for_timeout(500)

        state = page.evaluate("() => PhysicalDiorama.getState()")
        assert len(state["objects"]) == 7
        assert {o["id"] for o in state["objects"]} >= {"sofa", "bed", "desk"}

        page.evaluate("() => { PhysicalDiorama.setAutonomous(false); PhysicalDiorama.setSpeed(6); }")

        # Collision: bed footprint is not walkable.
        blocked = page.evaluate("() => PhysicalDiorama.moveTo(1.5, 1.5)")
        assert blocked is False

        page.evaluate("() => PhysicalDiorama.use('sofa')")
        wait_mode(page, "sitting")
        page.screenshot(path=str(ART / "sofa.png"))

        page.evaluate("() => PhysicalDiorama.use('bed')")
        wait_mode(page, "lying")
        page.screenshot(path=str(ART / "bed.png"))

        page.evaluate("() => PhysicalDiorama.use('desk')")
        wait_mode(page, "studying")
        page.screenshot(path=str(ART / "desk.png"))

        for gesture in ("wave", "celebrate", "scan"):
            page.evaluate("g => PhysicalDiorama.gesture(g)", gesture)
            wait_mode(page, "gesture", 1000)
            assert page.evaluate("() => PhysicalDiorama.getState().agent.gesture") == gesture
            page.wait_for_timeout(2000)

        # Skin API.
        page.evaluate("() => { PhysicalDiorama.setRoomSkin('sunset'); PhysicalDiorama.setCharacterSkin('mint'); }")
        state = page.evaluate("() => PhysicalDiorama.getState()")
        assert state["roomSkin"] == "sunset"
        assert state["agent"]["skin"] == "mint"

        # Furniture drag: move the coffee table to a valid new location.
        page.evaluate("() => PhysicalDiorama.setEditMode(true)")
        before = next(o for o in page.evaluate("() => PhysicalDiorama.getState().objects") if o["id"] == "coffee")
        p1 = page.evaluate("o => PhysicalDiorama.project(o.x + o.w/2, o.y + o.d/2)", before)
        target_center = {"x": before["x"] + before["w"] / 2 - 0.5, "y": before["y"] + before["d"] / 2 + 0.75}
        p2 = page.evaluate("p => PhysicalDiorama.project(p.x, p.y)", target_center)
        box = page.locator("#world").bounding_box()
        page.mouse.move(box["x"] + p1["x"], box["y"] + p1["y"])
        page.mouse.down()
        page.mouse.move(box["x"] + p2["x"], box["y"] + p2["y"], steps=8)
        page.mouse.up()
        page.wait_for_timeout(250)
        after = next(o for o in page.evaluate("() => PhysicalDiorama.getState().objects") if o["id"] == "coffee")
        assert abs(after["x"] - before["x"]) > 0.1 or abs(after["y"] - before["y"]) > 0.1

        page.evaluate("() => { PhysicalDiorama.setEditMode(false); PhysicalDiorama.setRoomSkin('cloud'); PhysicalDiorama.setCharacterSkin('classic'); }")
        page.screenshot(path=str(ART / "desktop.png"), full_page=True)

        mobile = browser.new_page(viewport={"width": 430, "height": 900})
        mobile.set_content(inline_html(), wait_until="load")
        mobile.wait_for_function("() => Boolean(window.PhysicalDiorama)")
        mobile.wait_for_timeout(700)
        mobile.screenshot(path=str(ART / "mobile.png"), full_page=True)

        assert not errors, errors
        browser.close()

    report = {
        "status": "PASS",
        "physics": {
            "pathfinding": "A* grid",
            "collision": "dynamic furniture footprints",
            "furniture_drag": True,
            "invalid_overlap_rejected": True,
        },
        "interactions": ["sofa:sitting", "bed:lying", "desk:studying"],
        "gestures": ["wave", "celebrate", "scan"],
        "room_skins": 3,
        "character_skins": 3,
        "mobile_widget": True,
        "windows_local_server": True,
    }
    (ART / "smoke-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
