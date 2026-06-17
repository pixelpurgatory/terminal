/* =============================================================================
 *  MATRIX DIGITAL RAIN
 *  Canvas background. Tuned to stay subtle so foreground text reads cleanly.
 *  Respects prefers-reduced-motion. Pauses when tab is hidden.
 * ===========================================================================*/
(function () {
  const canvas = document.getElementById("matrix-rain");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });

  // Glyphs: katakana + latin + digits, the classic mix.
  const GLYPHS =
    "アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズヅブプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポ" +
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$+-<>*/";

  const FONT_SIZE = 16;
  let cols = 0;
  let drops = [];
  let speeds = [];
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(window.innerWidth / FONT_SIZE);
    drops = new Array(cols);
    speeds = new Array(cols);
    for (let i = 0; i < cols; i++) {
      drops[i] = Math.random() * -window.innerHeight / FONT_SIZE;
      speeds[i] = 0.35 + Math.random() * 0.65;
    }
  }

  function glyph() {
    return GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
  }

  let raf = null;
  let last = 0;
  const FRAME = 1000 / 30; // cap at ~30fps for the rain; plenty smooth, light on CPU

  function draw(ts) {
    raf = requestAnimationFrame(draw);
    if (ts - last < FRAME) return;
    last = ts;

    // Fade the previous frame for the trailing-tail effect.
    ctx.fillStyle = "rgba(2, 8, 4, 0.085)";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.font = FONT_SIZE + "px 'JetBrains Mono', 'SF Mono', Menlo, monospace";
    ctx.textBaseline = "top";

    for (let i = 0; i < cols; i++) {
      const x = i * FONT_SIZE;
      const y = drops[i] * FONT_SIZE;
      const ch = glyph();

      // Leading character is bright white-green; tail is dim green.
      ctx.fillStyle = "rgba(190, 255, 200, 0.95)";
      ctx.fillText(ch, x, y);
      ctx.fillStyle = "rgba(0, 220, 80, 0.32)";
      ctx.fillText(glyph(), x, y - FONT_SIZE);

      if (y > window.innerHeight && Math.random() > 0.975) {
        drops[i] = Math.random() * -20;
        speeds[i] = 0.35 + Math.random() * 0.65;
      }
      drops[i] += speeds[i];
    }
  }

  function start() {
    if (raf) cancelAnimationFrame(raf);
    if (reduced) {
      // Static single frame so the backdrop still has texture.
      ctx.fillStyle = "rgba(2, 8, 4, 1)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      return;
    }
    raf = requestAnimationFrame(draw);
  }

  window.addEventListener("resize", () => { resize(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else start();
  });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
    reduced = e.matches; start();
  });

  resize();
  start();
})();
