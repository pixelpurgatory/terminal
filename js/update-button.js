/* =============================================================================
 *  MATRIX TERMINAL  ·  MANUAL FULL-UPDATE TRIGGER
 *  -----------------------------------------------------------------------------
 *  The terminal is a static site, so the "FULL UPDATE" button triggers the AI
 *  research by calling GitHub's workflow_dispatch API directly from the browser
 *  (mode=full → researches all signals + price + news and commits the site).
 *
 *  Auth: a GitHub fine-grained PAT (scope: Actions read+write on this repo) is
 *  entered once and kept ONLY in this browser's localStorage — never in the code
 *  or the repo. A client-side cooldown limits it to one full update per 24h.
 *
 *  The daily automated run is separate (news+price → Telegram only) and does not
 *  update the site; this button is the only thing that refreshes the signals.
 * ===========================================================================*/
(function () {
  "use strict";

  // Repo coordinates. Overridable via localStorage (matrix_gh_owner/repo/ref)
  // without editing the source — e.g. point `ref` at whatever branch GitHub
  // Pages serves and that carries this workflow.
  const GH = {
    owner: localStorage.getItem("matrix_gh_owner") || "pixelpurgatory",
    repo: localStorage.getItem("matrix_gh_repo") || "terminal",
    workflow: "update-signals.yml",
    ref: localStorage.getItem("matrix_gh_ref") || "claude/matrix-stocks-terminal-v8u4pp",
  };

  const COOLDOWN_MS = 24 * 60 * 60 * 1000;   // one full update per 24h
  const TS_KEY = "matrix_full_update_ts";
  const TOK_KEY = "matrix_gh_token";

  const lastRun = () => Number(localStorage.getItem(TS_KEY)) || 0;
  const remaining = () => Math.max(0, COOLDOWN_MS - (Date.now() - lastRun()));
  function fmtRemaining(ms) {
    const h = Math.floor(ms / 3.6e6);
    const m = Math.ceil((ms % 3.6e6) / 6e4);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  async function dispatch(token) {
    const url = `https://api.github.com/repos/${GH.owner}/${GH.repo}/actions/workflows/${GH.workflow}/dispatches`;
    return fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: GH.ref, inputs: { mode: "full" } }),
    });
  }

  let btn = null;

  function refresh() {
    if (!btn) return;
    const rem = remaining();
    if (rem > 0) {
      btn.disabled = true;
      btn.textContent = `⟳ UPDATE ${fmtRemaining(rem)}`;
      btn.title = "Full update is on a 24h cooldown.";
    } else {
      btn.disabled = false;
      btn.textContent = "⟳ FULL UPDATE";
      btn.title = "Run AI research now (signals + price + news). Max once per 24h.";
    }
  }

  async function trigger(log) {
    const say = typeof log === "function" ? log : ((m) => console.log(m));
    const rem = remaining();
    if (rem > 0) {
      say(`⛔ full update on cooldown — try again in ${fmtRemaining(rem)}`);
      refresh();
      return;
    }
    let token = localStorage.getItem(TOK_KEY);
    if (!token) {
      token = window.prompt(
        "Paste a GitHub fine-grained token (scope: Actions Read+Write on this repo).\n" +
        "It is stored ONLY in this browser, never in the page or repo."
      );
      if (!token) { say("full update cancelled — no token provided"); return; }
      token = token.trim();
      localStorage.setItem(TOK_KEY, token);
    }
    say("⟳ dispatching full update…");
    try {
      const res = await dispatch(token);
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem(TOK_KEY);
        say(`✖ auth failed (${res.status}). Token cleared — click again to re-enter it.`);
        return;
      }
      if (res.status !== 204) {
        const body = await res.text().catch(() => "");
        say(`✖ dispatch failed (${res.status}): ${body.slice(0, 160)}`);
        return;
      }
      localStorage.setItem(TS_KEY, String(Date.now()));
      say("✓ full update triggered. Signals refresh in a few minutes — reload the page then.");
      refresh();
    } catch (e) {
      // A network/CORS failure or bad repo coordinates land here.
      say(`✖ dispatch error: ${e.message}`);
    }
  }

  function mount(log) {
    btn = document.getElementById("full-update");
    if (btn) {
      btn.addEventListener("click", () => trigger(log));
      refresh();
      setInterval(refresh, 60000); // tick the cooldown label
    }
  }

  window.MatrixUpdate = { mount, trigger };
})();
