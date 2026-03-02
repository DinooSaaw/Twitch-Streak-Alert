const els = {
  enabled: document.getElementById("enabled"),
  enableNotifications: document.getElementById("enableNotifications"),
  enableSound: document.getElementById("enableSound"),
  alertOnFirstDetection: document.getElementById("alertOnFirstDetection"),
  autoOpenCloseMenu: document.getElementById("autoOpenCloseMenu"),
  debug: document.getElementById("debug"),
  hudVisibleSeconds: document.getElementById("hudVisibleSeconds"),
  reset: document.getElementById("reset"),
  status: document.getElementById("status"),
  channelsWrap: document.getElementById("channelsWrap")
};

const HUD_VISIBLE_SECONDS_DEFAULT = 60;
const HUD_VISIBLE_SECONDS_MIN = 5;
const HUD_VISIBLE_SECONDS_MAX = 600;
let channelsState = {};
let sortByState = "lastSeen";
let sortOrderState = "desc";

function setStatus(msg) {
  els.status.textContent = msg || "";
  if (msg) setTimeout(() => (els.status.textContent = ""), 1600);
}

function normalizeHudVisibleSeconds(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return HUD_VISIBLE_SECONDS_DEFAULT;
  return Math.min(HUD_VISIBLE_SECONDS_MAX, Math.max(HUD_VISIBLE_SECONDS_MIN, Math.round(n)));
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

function getSortValue(entry, sortBy) {
  if (sortBy === "name") return entry.name.toLowerCase();
  if (sortBy === "streak") return Number(entry.state?.lastValue ?? Number.NEGATIVE_INFINITY);
  if (sortBy === "lastIncrease") return Number(bestLastIncrease(entry.state)?.at ?? 0);
  return Number(entry.state?.lastSeenAt ?? 0);
}

function compareEntries(a, b) {
  const aVal = getSortValue(a, sortByState);
  const bVal = getSortValue(b, sortByState);
  const direction = sortOrderState === "asc" ? 1 : -1;

  if (sortByState === "name") {
    const cmp = String(aVal).localeCompare(String(bVal));
    if (cmp !== 0) return cmp * direction;
  } else if (aVal !== bVal) {
    return (aVal - bVal) * direction;
  }

  return a.name.localeCompare(b.name);
}

function sortHeaderLabel(sortBy, text) {
  const active = sortByState === sortBy;
  const arrow = active && sortOrderState === "desc" ? " ▼" : "";
  return `${text}${arrow}`;
}

function renderChannelsTable() {
  const entries = Object.entries(channelsState || {})
    .map(([name, state]) => ({ name, state }))
    .sort(compareEntries);

  if (!entries.length) {
    els.channelsWrap.innerHTML = `<div class="tiny">No channels tracked yet.</div>`;
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th data-sort-by="name" style="cursor:pointer;">${escapeHtml(sortHeaderLabel("name", "Channel"))}</th>
          <th data-sort-by="streak" style="cursor:pointer;">${escapeHtml(sortHeaderLabel("streak", "Streak"))}</th>
          <th data-sort-by="lastIncrease" style="cursor:pointer;">${escapeHtml(sortHeaderLabel("lastIncrease", "Last increase"))}</th>
          <th data-sort-by="lastSeen" style="cursor:pointer;">${escapeHtml(sortHeaderLabel("lastSeen", "Last seen"))}</th>
          <th>Actions</th>
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
        <td>${escapeHtml(seen)}</td>
        <td style="text-align:right;">
          <button class="btn danger" data-remove-channel="${escapeHtml(name)}">Remove</button>
        </td>
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
  els.autoOpenCloseMenu.checked = settings.autoOpenCloseMenu === true; // default OFF
  els.debug.checked = settings.debug === true; // default OFF
  els.hudVisibleSeconds.value = String(
    normalizeHudVisibleSeconds(settings.hudVisibleSeconds ?? HUD_VISIBLE_SECONDS_DEFAULT)
  );

  channelsState = channels;
  renderChannelsTable();
}

async function save() {
  const hudVisibleSeconds = normalizeHudVisibleSeconds(els.hudVisibleSeconds.value);
  els.hudVisibleSeconds.value = String(hudVisibleSeconds);

  const settings = {
    enabled: els.enabled.checked,
    enableNotifications: els.enableNotifications.checked,
    enableSound: els.enableSound.checked,
    alertOnFirstDetection: els.alertOnFirstDetection.checked,
    autoOpenCloseMenu: els.autoOpenCloseMenu.checked,
    debug: els.debug.checked,
    hudVisibleSeconds
  };
  await chrome.storage.local.set({ settings });
  setStatus("Saved.");
}

els.enabled.addEventListener("change", save);
els.enableNotifications.addEventListener("change", save);
els.enableSound.addEventListener("change", save);
els.alertOnFirstDetection.addEventListener("change", save);
els.autoOpenCloseMenu.addEventListener("change", save);
els.debug.addEventListener("change", save);
els.hudVisibleSeconds.addEventListener("change", save);
els.hudVisibleSeconds.addEventListener("blur", save);

els.channelsWrap.addEventListener("click", async (event) => {
  const sortHeader = event.target.closest("[data-sort-by]");
  if (sortHeader) {
    const selectedSortBy = sortHeader.getAttribute("data-sort-by");
    if (!selectedSortBy) return;
    if (sortByState === selectedSortBy) {
      sortOrderState = sortOrderState === "desc" ? "asc" : "desc";
    } else {
      sortByState = selectedSortBy;
      sortOrderState = "desc";
    }
    renderChannelsTable();
    return;
  }

  const btn = event.target.closest("[data-remove-channel]");
  if (!btn) return;
  const channel = btn.getAttribute("data-remove-channel");
  if (!channel || !channelsState[channel]) return;

  delete channelsState[channel];
  await chrome.storage.local.set({ channels: channelsState });
  renderChannelsTable();
  setStatus(`Removed ${channel}.`);
});

els.reset.addEventListener("click", async () => {
  channelsState = {};
  await chrome.storage.local.set({ channels: {} });
  renderChannelsTable();
  setStatus("Reset complete.");
});

load();
