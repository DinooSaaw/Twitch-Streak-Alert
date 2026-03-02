const COLLAPSED_TRACKED_COUNT = 5;
const STALE_CHANGE_MS = 12 * 60 * 60 * 1000;
const TIP_ROTATE_MS = 4500;

const TIP_HTML = [
  "Tip: Turn on <b>Debug HUD Updates</b> in Settings if the streak widget is not being detected.",
  "Tip: Open a channel page and let the watch streak widget render once to start tracking.",
  "Tip: Use <b>Alert on First Detection</b> if you want notifications before any increase happens.",
  "Tip: Set a longer HUD visible time in Settings if you want updates to stay on screen."
];

let showAllTracked = false;
let tipTimer = null;

function fmtTime(ts) {
  if (!ts) return "--";
  const d = new Date(ts);
  return d.toLocaleString();
}

function channelFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "www.twitch.tv") return null;

    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;

    if (parts[0].toLowerCase() === "moderator") {
      return parts[1] ? parts[1].toLowerCase() : null;
    }

    const candidate = parts[0].toLowerCase();
    const blocked = new Set([
      "directory", "videos", "settings", "downloads", "turbo", "wallet", "subscriptions",
      "inventory", "friends", "messages", "search", "jobs", "p", "user", "creatorcamp", "prime"
    ]);
    if (blocked.has(candidate)) return null;
    return candidate;
  } catch {
    return null;
  }
}

function bestLastIncrease(state) {
  const history = Array.isArray(state.history) ? state.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.kind === "increase") return history[i];
  }
  return null;
}

function lastChangeEvent(state) {
  const history = Array.isArray(state.history) ? state.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const ev = history[i];
    if (ev?.kind === "increase" || ev?.kind === "decrease") return ev;
  }
  return null;
}

function getLastUpdatedAt(state) {
  return Number(state?.lastUpdatedAt ?? state?.lastSeenAt ?? 0);
}

function setTip(index) {
  const tipTextEl = document.getElementById("tipText");
  if (!tipTextEl) return;
  tipTextEl.innerHTML = TIP_HTML[index % TIP_HTML.length];
}

function startTipCycle() {
  if (!TIP_HTML.length) return;
  let idx = Math.floor(Math.random() * TIP_HTML.length);
  setTip(idx);
  tipTimer = setInterval(() => {
    idx = (idx + 1) % TIP_HTML.length;
    setTip(idx);
  }, TIP_ROTATE_MS);
}

function renderTrackedList(entries, trackedListEl, toggleTrackedEl) {
  trackedListEl.innerHTML = "";

  const shouldCollapse = entries.length > COLLAPSED_TRACKED_COUNT;
  const visibleEntries = shouldCollapse && !showAllTracked
    ? entries.slice(0, COLLAPSED_TRACKED_COUNT)
    : entries;

  for (const { name, state } of visibleEntries) {
    const change = lastChangeEvent(state);
    const stale = Boolean(change?.at) && (Date.now() - change.at) > STALE_CHANGE_MS;

    const item = document.createElement("div");
    item.className = "item";

    const left = document.createElement("div");
    left.className = "left";

    const label = document.createElement("div");
    label.className = `label${stale ? " stale" : ""}`;
    label.textContent = name;

    const meta = document.createElement("div");
    meta.className = "meta";
    if (change?.kind === "increase") {
      meta.classList.add("up");
      meta.textContent = `${change.from} -> ${change.to} | ${fmtTime(change.at)}`;
    } else if (change?.kind === "decrease") {
      meta.classList.add("down");
      meta.textContent = `${change.to} <- ${change.from} | ${fmtTime(change.at)}`;
    } else {
      meta.textContent = `Last updated | ${fmtTime(getLastUpdatedAt(state))}`;
    }

    left.appendChild(label);
    left.appendChild(meta);

    const value = document.createElement("div");
    value.className = "value";
    value.textContent = state.lastValue != null ? String(state.lastValue) : "--";

    item.appendChild(left);
    item.appendChild(value);

    trackedListEl.appendChild(item);
  }

  if (shouldCollapse) {
    toggleTrackedEl.style.display = "block";
    toggleTrackedEl.textContent = showAllTracked ? "Show Less" : "Show More";
  } else {
    toggleTrackedEl.style.display = "none";
  }
}

async function loadPopup() {
  const statusPill = document.getElementById("statusPill");
  const currentChannelEl = document.getElementById("currentChannel");
  const currentMetaEl = document.getElementById("currentMeta");
  const currentStreakEl = document.getElementById("currentStreak");
  const trackedListEl = document.getElementById("trackedList");
  const emptyStateEl = document.getElementById("emptyState");
  const toggleTrackedEl = document.getElementById("toggleTracked");

  const { settings = {}, channels = {} } = await chrome.storage.local.get(["settings", "channels"]);

  const enabled = settings.enabled !== false;
  statusPill.textContent = enabled ? "Enabled" : "Disabled";
  statusPill.className = `pill ${enabled ? "on" : "off"}`;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentChannel = tab?.url ? channelFromUrl(tab.url) : null;

  if (currentChannel && channels[currentChannel]?.lastValue != null) {
    const state = channels[currentChannel];
    currentChannelEl.textContent = currentChannel;
    currentStreakEl.textContent = String(state.lastValue);
    const change = lastChangeEvent(state);
    const inc = bestLastIncrease(state);
    currentMetaEl.className = "meta";
    if (change?.kind === "increase") {
      currentMetaEl.classList.add("up");
      currentMetaEl.textContent = `${change.from} -> ${change.to} | ${fmtTime(change.at)}`;
    } else if (change?.kind === "decrease") {
      currentMetaEl.classList.add("down");
      currentMetaEl.textContent = `${change.to} <- ${change.from} | ${fmtTime(change.at)}`;
    } else {
      currentMetaEl.textContent =
        inc
          ? `Last increase: ${inc.from} -> ${inc.to} at ${fmtTime(inc.at)}`
          : `Last updated: ${fmtTime(getLastUpdatedAt(state))}`;
    }
  } else if (currentChannel) {
    currentChannelEl.textContent = currentChannel;
    currentStreakEl.textContent = "--";
    currentMetaEl.className = "meta";
    currentMetaEl.textContent = "Open the watch streak widget once to detect it.";
  } else {
    currentChannelEl.textContent = "Not on a channel";
    currentStreakEl.textContent = "--";
    currentMetaEl.className = "meta";
    currentMetaEl.textContent = "Open a Twitch channel page to show it here.";
  }

  const entries = Object.entries(channels)
    .map(([name, state]) => ({ name, state }))
    .sort((a, b) => getLastUpdatedAt(b.state) - getLastUpdatedAt(a.state));

  if (!entries.length) {
    trackedListEl.innerHTML = "";
    emptyStateEl.style.display = "block";
    toggleTrackedEl.style.display = "none";
  } else {
    emptyStateEl.style.display = "none";
    renderTrackedList(entries, trackedListEl, toggleTrackedEl);
    toggleTrackedEl.addEventListener("click", () => {
      showAllTracked = !showAllTracked;
      renderTrackedList(entries, trackedListEl, toggleTrackedEl);
    });
  }

  document.getElementById("openSettings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

startTipCycle();
window.addEventListener("unload", () => {
  if (tipTimer) clearInterval(tipTimer);
});
loadPopup();
