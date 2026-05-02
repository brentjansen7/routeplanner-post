"""Test of bezorg-modus de huidige stop centraal op de kaart toont."""
from playwright.sync_api import sync_playwright
import time

def test_bezorg_centering():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 414, "height": 896})
        page = context.new_page()

        logs = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: logs.append(f"[ERROR] {err}"))

        # Service worker uitschakelen voor schone test
        page.route("**/sw.js", lambda route: route.fulfill(status=404, body=""))

        page.goto("http://localhost:8080/index.html", wait_until="networkidle")
        time.sleep(1.0)

        has_test = page.evaluate("typeof window.__test")
        print(f"window.__test type: {has_test}")
        if has_test == "undefined":
            print("FAIL: __test handle niet aanwezig")
            browser.close()
            return

        # Voeg 3 fake stops toe
        page.evaluate("""
            const T = window.__test;
            const stops = [
                { lat: 51.9145, lng: 4.5953, name: 'Lavendel 63, Krimpen' },
                { lat: 51.9189, lng: 4.6012, name: 'Vijverlaan 12, Krimpen' },
                { lat: 51.9201, lng: 4.5887, name: 'De Brink 4, Krimpen' },
            ];
            stops.forEach(s => T.addMarker(s.lat, s.lng, s.name));
        """)
        time.sleep(0.3)

        # Start bezorgmodus direct
        page.evaluate("""
            const T = window.__test;
            T.state.bezorgOrder = T.state.stops.slice();
            T.state.activeCourier = 0;
            T.startBezorgModus();
        """)
        time.sleep(1.5)

        page.screenshot(path="test_stop1.png")
        print("Screenshot: test_stop1.png")

        # Check stop 1
        info1 = page.evaluate("""
            (() => {
                const T = window.__test;
                const stop = T.state.bezorgOrder[T.state.bezorgIdx];
                if (!stop) return { error: 'geen stop' };
                const point = T.map.latLngToContainerPoint([stop.lat, stop.lng]);
                const mapEl = document.getElementById('map');
                const mapRect = mapEl.getBoundingClientRect();
                const panelEl = document.getElementById('bezorg-scherm');
                const panelRect = panelEl ? panelEl.getBoundingClientRect() : null;
                const panelTop = panelRect ? panelRect.top : mapRect.height;
                return {
                    stopName: stop.name,
                    stopIdx: T.state.bezorgIdx,
                    pixelX: Math.round(point.x),
                    pixelY: Math.round(point.y),
                    mapWidth: Math.round(mapRect.width),
                    mapHeight: Math.round(mapRect.height),
                    panelTop: Math.round(panelTop),
                    panelHeight: panelRect ? Math.round(panelRect.height) : 0,
                    visibleAreaCenter: Math.round(panelTop / 2),
                    isAbovePanel: point.y < panelTop,
                    isInVisibleArea: point.y > 0 && point.y < panelTop,
                    distanceFromVisibleCenter: Math.round(Math.abs(point.y - panelTop / 2)),
                };
            })()
        """)
        print(f"\n=== STOP 1 (initieel) ===")
        for k, v in info1.items():
            print(f"  {k}: {v}")

        # Klik BEZORGD -> ga naar stop 2
        page.click("#bs-bezorgd")
        time.sleep(1.5)
        page.screenshot(path="test_stop2.png")
        print("\nScreenshot: test_stop2.png")

        info2 = page.evaluate("""
            (() => {
                const T = window.__test;
                const stop = T.state.bezorgOrder[T.state.bezorgIdx];
                if (!stop) return { error: 'geen stop' };
                const point = T.map.latLngToContainerPoint([stop.lat, stop.lng]);
                const panelEl = document.getElementById('bezorg-scherm');
                const panelRect = panelEl ? panelEl.getBoundingClientRect() : null;
                const panelTop = panelRect ? panelRect.top : 800;
                return {
                    stopName: stop.name,
                    stopIdx: T.state.bezorgIdx,
                    pixelX: Math.round(point.x),
                    pixelY: Math.round(point.y),
                    panelTop: Math.round(panelTop),
                    isInVisibleArea: point.y > 0 && point.y < panelTop,
                    distanceFromVisibleCenter: Math.round(Math.abs(point.y - panelTop / 2)),
                };
            })()
        """)
        print(f"\n=== STOP 2 (na bezorgd) ===")
        for k, v in info2.items():
            print(f"  {k}: {v}")

        # Klik nogmaals BEZORGD -> ga naar stop 3
        page.click("#bs-bezorgd")
        time.sleep(1.5)
        page.screenshot(path="test_stop3.png")
        print("\nScreenshot: test_stop3.png")

        info3 = page.evaluate("""
            (() => {
                const T = window.__test;
                const stop = T.state.bezorgOrder[T.state.bezorgIdx];
                if (!stop) return { error: 'geen stop' };
                const point = T.map.latLngToContainerPoint([stop.lat, stop.lng]);
                const panelEl = document.getElementById('bezorg-scherm');
                const panelRect = panelEl ? panelEl.getBoundingClientRect() : null;
                const panelTop = panelRect ? panelRect.top : 800;
                return {
                    stopName: stop.name,
                    stopIdx: T.state.bezorgIdx,
                    pixelX: Math.round(point.x),
                    pixelY: Math.round(point.y),
                    panelTop: Math.round(panelTop),
                    isInVisibleArea: point.y > 0 && point.y < panelTop,
                    distanceFromVisibleCenter: Math.round(Math.abs(point.y - panelTop / 2)),
                };
            })()
        """)
        print(f"\n=== STOP 3 (na 2e bezorgd) ===")
        for k, v in info3.items():
            print(f"  {k}: {v}")

        print("\n=== VERDICT ===")
        results = [info1, info2, info3]
        all_visible = all(r.get("isInVisibleArea") for r in results)
        all_centered = all(r.get("distanceFromVisibleCenter", 999) < 100 for r in results)

        if all_visible:
            print("PASS: alle markers in zichtbare gebied (boven paneel)")
        else:
            print("FAIL: niet alle markers zichtbaar:")
            for i, r in enumerate(results):
                vis = r.get("isInVisibleArea")
                print(f"  stop {i+1}: visible={vis}, y={r.get('pixelY')}, panelTop={r.get('panelTop')}")

        if all_centered:
            print("PASS: markers gecentreerd (<100px vanaf midden)")
        else:
            print("PARTIAL: markers niet perfect gecentreerd:")
            for i, r in enumerate(results):
                d = r.get("distanceFromVisibleCenter", 999)
                print(f"  stop {i+1}: {d}px vanaf midden")

        if logs:
            errs = [l for l in logs if "ERROR" in l or "[error]" in l]
            if errs:
                print("\n=== ERRORS ===")
                for e in errs:
                    print(f"  {e}")

        browser.close()
        return all_visible and all_centered

if __name__ == "__main__":
    ok = test_bezorg_centering()
    print(f"\n{'TEST GESLAAGD' if ok else 'TEST GEFAALD'}")
