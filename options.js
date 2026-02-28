const els = {
  enabled: document.getElementById("enabled"),
  enableNotifications: document.getElementById("enableNotifications"),
  enableSound: document.getElementById("enableSound"),
  alertOnFirstDetection: document.getElementById("alertOnFirstDetection"),
  debug: document.getElementById("debug"),
  reset: document.getElementById("reset"),
  status: document.getElementById("status"),
  channelsWrap: document.getElementById("channelsWrap")
};

function setStatus(msg) {
  els.status.textContent = msg || "";
  if (msg) setTimeout(() => (els.status.textContent = ""), 1600);
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function bestLastIncrease(state) {
  const history = Array.isArray(state.history) ? state.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.kind === "increase") return history[i];
  }
  return null;
}

function renderChannelsTable(channels) {
  const entries = Object.entries(channels || {})
    .map(([name, state]) => ({ name, state }))
    .sort((a, b) => (b.state?.lastSeenAt || 0) - (a.state?.lastSeenAt || 0));

  if (!entries.length) {
    els.channelsWrap.innerHTML = `<div class="tiny">No channels tracked yet.</div>`;
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th>Channel</th>
          <th>Streak</th>
          <th>Last increase</th>
          <th>Last seen</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const { name, state } of entries) {
    const inc = bestLastIncrease(state);
    const incText = inc ? `${inc.from} → ${inc.to} @ ${fmtTime(inc.at)}` : "—";
    const streak = state.lastValue != null ? state.lastValue : "—";
    const seen = fmtTime(state.lastSeenAt);

    html += `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(String(streak))}</td>
        <td>${escapeHtml(incText)}</td>
        <td style="text-align:right;">${escapeHtml(seen)}</td>
      </tr>
    `;
  }

  html += `</tbody></table>`;
  els.channelsWrap.innerHTML = html;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function load() {
  const { settings = {}, channels = {} } = await chrome.storage.local.get(["settings", "channels"]);

  els.enabled.checked = settings.enabled !== false; // default ON
  els.enableNotifications.checked = settings.enableNotifications !== false; // default ON
  els.enableSound.checked = settings.enableSound === true; // default OFF
  els.alertOnFirstDetection.checked = settings.alertOnFirstDetection === true; // default OFF
  els.debug.checked = settings.debug === true; // default OFF

  renderChannelsTable(channels);
}

async function save() {
  const settings = {
    enabled: els.enabled.checked,
    enableNotifications: els.enableNotifications.checked,
    enableSound: els.enableSound.checked,
    alertOnFirstDetection: els.alertOnFirstDetection.checked,
    debug: els.debug.checked
  };
  await chrome.storage.local.set({ settings });
  setStatus("Saved.");
}

els.enabled.addEventListener("change", save);
els.enableNotifications.addEventListener("change", save);
els.enableSound.addEventListener("change", save);
els.alertOnFirstDetection.addEventListener("change", save);
els.debug.addEventListener("change", save);

els.reset.addEventListener("click", async () => {
  await chrome.storage.local.set({ channels: {} });
  renderChannelsTable({});
  setStatus("Reset complete.");
});

load();