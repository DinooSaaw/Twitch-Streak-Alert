function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

function channelFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "www.twitch.tv") return null;

    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;

    const candidate = parts[0].toLowerCase();
    const blocked = new Set([
      "directory","videos","settings","downloads","turbo","wallet","subscriptions",
      "inventory","friends","messages","search","jobs","p","user","moderator","creatorcamp","prime"
    ]);
    if (blocked.has(candidate)) return null;
    return candidate;
  } catch {
    return null;
  }
}

function bestLastIncrease(state) {
  const history = Array.isArray(state.history) ? state.history : [];
  // find last "increase" event
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.kind === "increase") return history[i];
  }
  return null;
}

async function loadPopup() {
  const statusPill = document.getElementById("statusPill");
  const currentChannelEl = document.getElementById("currentChannel");
  const currentMetaEl = document.getElementById("currentMeta");
  const currentStreakEl = document.getElementById("currentStreak");
  const trackedListEl = document.getElementById("trackedList");
  const emptyStateEl = document.getElementById("emptyState");

  const { settings = {}, channels = {} } = await chrome.storage.local.get(["settings", "channels"]);

  const enabled = settings.enabled !== false;
  statusPill.textContent = enabled ? "Enabled" : "Disabled";
  statusPill.className = `pill ${enabled ? "on" : "off"}`;

  // Current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentChannel = tab?.url ? channelFromUrl(tab.url) : null;

  if (currentChannel && channels[currentChannel]?.lastValue != null) {
    const state = channels[currentChannel];
    currentChannelEl.textContent = currentChannel;
    currentStreakEl.textContent = String(state.lastValue);
    const inc = bestLastIncrease(state);
    currentMetaEl.textContent =
      inc
        ? `Last increase: ${inc.from} → ${inc.to} at ${fmtTime(inc.at)}`
        : `Last seen: ${fmtTime(state.lastSeenAt)}`;
  } else if (currentChannel) {
    currentChannelEl.textContent = currentChannel;
    currentStreakEl.textContent = "—";
    currentMetaEl.textContent = "Open the watch streak widget once to detect it.";
  } else {
    currentChannelEl.textContent = "Not on a channel";
    currentStreakEl.textContent = "—";
    currentMetaEl.textContent = "Open a Twitch channel page to show it here.";
  }

  // Build tracked list sorted by lastSeenAt desc
  const entries = Object.entries(channels)
    .map(([name, state]) => ({ name, state }))
    .sort((a, b) => (b.state?.lastSeenAt || 0) - (a.state?.lastSeenAt || 0));

  trackedListEl.innerHTML = "";
  if (!entries.length) {
    emptyStateEl.style.display = "block";
  } else {
    emptyStateEl.style.display = "none";
    const max = Math.min(entries.length, 8); // keep popup short
    for (let i = 0; i < max; i++) {
      const { name, state } = entries[i];
      const inc = bestLastIncrease(state);

      const item = document.createElement("div");
      item.className = "item";

      const left = document.createElement("div");
      left.className = "left";

      const label = document.createElement("div");
      label.className = "label";
      label.textContent = name;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = inc
        ? `↑ ${inc.from} → ${inc.to} • ${fmtTime(inc.at)}`
        : `Last seen • ${fmtTime(state.lastSeenAt)}`;

      left.appendChild(label);
      left.appendChild(meta);

      const value = document.createElement("div");
      value.className = "value";
      value.textContent = state.lastValue != null ? String(state.lastValue) : "—";

      item.appendChild(left);
      item.appendChild(value);

      trackedListEl.appendChild(item);
    }
  }

  document.getElementById("openSettings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

loadPopup();