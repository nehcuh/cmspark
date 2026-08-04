/**
 * SPA-aware scroll expression for CDP Runtime.evaluate.
 * Used by browser-bridge scroll (CDP-first path for x.com / CSP pages).
 * Pure string builder — unit-tested; numbers only, no user strings.
 */
export function buildSpaScrollExpression(
  dx: number,
  dy: number,
  wheelX: number,
  wheelY: number,
): string {
  const n = (v: number) => String(Number(v) || 0)
  return `(() => {
      var dx = ${n(dx)}, dy = ${n(dy)}, wheelX = ${n(wheelX)}, wheelY = ${n(wheelY)};
      function isScrollable(el) {
        if (!el || el.nodeType !== 1) return false;
        var st = getComputedStyle(el);
        var oy = st.overflowY;
        if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") return false;
        return el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 80;
      }
      function pickScrollable() {
        var prefs = [
          '[data-testid="primaryColumn"]',
          'main[role="main"]',
          '[role="main"]',
          '[data-testid="cellInnerDiv"]',
          "div[aria-label*='Timeline']",
          "section[role='region']"
        ];
        for (var i = 0; i < prefs.length; i++) {
          var el = document.querySelector(prefs[i]);
          if (el && isScrollable(el)) return el;
          if (el) {
            var all = el.querySelectorAll("*");
            for (var j = 0; j < all.length; j++) {
              if (isScrollable(all[j])) return all[j];
            }
          }
        }
        var best = null, bestRoom = 0;
        var nodes = document.querySelectorAll("body *");
        for (var k = 0; k < nodes.length; k++) {
          if (!isScrollable(nodes[k])) continue;
          var room = nodes[k].scrollHeight - nodes[k].clientHeight;
          if (room > bestRoom) { bestRoom = room; best = nodes[k]; }
        }
        return best;
      }
      var winBefore = window.scrollY || document.documentElement.scrollTop || 0;
      var target = pickScrollable();
      if (target) {
        var before = target.scrollTop;
        target.scrollBy({ left: dx, top: dy, behavior: "auto" });
        if (Math.abs(target.scrollTop - before) < 2 && dy !== 0) target.scrollTop = before + dy;
        try {
          var r = target.getBoundingClientRect();
          target.dispatchEvent(new WheelEvent("wheel", {
            bubbles: true, cancelable: true, deltaX: dx, deltaY: dy,
            clientX: r.left + Math.min(r.width / 2, 200),
            clientY: r.top + Math.min(r.height / 2, 200)
          }));
        } catch (e) {}
        var after = target.scrollTop;
        return {
          mode: "element", moved: Math.abs(after - before) >= 2,
          before: before, after: after, deltaRequested: dy,
          tag: target.tagName, testid: target.getAttribute("data-testid"),
          scrollHeight: target.scrollHeight, clientHeight: target.clientHeight,
          windowScrollY: winBefore
        };
      }
      window.scrollBy(dx, dy);
      try {
        document.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true, deltaX: dx, deltaY: dy,
          clientX: wheelX, clientY: wheelY
        }));
      } catch (e) {}
      var winAfter = window.scrollY || document.documentElement.scrollTop || 0;
      return {
        mode: "window", moved: Math.abs(winAfter - winBefore) >= 2,
        before: winBefore, after: winAfter, deltaRequested: dy, windowScrollY: winAfter
      };
    })()`
}
