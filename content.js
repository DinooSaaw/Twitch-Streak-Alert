// Twitch Watch Streak Alerts - Content Script (MV3)

const STREAK_LABEL = "Your Watch Streak:";
const CHECK_THROTTLE_MS = 800;
const DUPLICATE_COOLDOWN_MS = 30_000;

let lastCheckAt = 0;
let lastAlertAt = 0;
let lastAlertValue = null;

function getChannelFromPath() {
  const path = location.pathname.split("/").filter(Boolean);
  if (path.length === 0) return null;

  const candidate = path[0].toLowerCase();

  const blocked = new Set([
    "directory",
    "videos",
    "settings",
    "downloads",
    "turbo",
    "wallet",
    "subscriptions",
    "inventory",
    "friends",
    "messages",
    "search",
    "jobs",
    "p",
    "user",
    "moderator",
    "creatorcamp",
    "prime"
  ]);

  if (blocked.has(candidate)) return null;
  return candidate;
}

function normalizeSpaces(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function parseStreakFromText(text) {
  const t = normalizeSpaces(text);
  if (!t.includes(STREAK_LABEL)) return null;
  const match = t.match(/Your Watch Streak:\s*(\d+)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function findStreakValueInDOM() {
  const elements = document.querySelectorAll("body *");
  for (const el of elements) {
    const t = el.innerText;
    if (t && t.includes(STREAK_LABEL)) {
      const v = parseStreakFromText(t);
      if (v !== null) return v;
    }

    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && aria.includes(STREAK_LABEL)) {
      const v = parseStreakFromText(aria);
      if (v !== null) return v;
    }
  }
  return null;
}

function playBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.value = 880;

    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);

    o.connect(g);
    g.connect(ctx.destination);

    o.start();
    o.stop(ctx.currentTime + 0.26);

    o.onended = () => ctx.close().catch(() => {});
  } catch {
    // ignore
  }
}

function debugToast(msg) {
  let el = document.getElementById("streak-alert-debug");
  if (!el) {
    el = document.createElement("div");
    el.id = "streak-alert-debug";
    el.style.position = "fixed";
    el.style.right = "12px";
    el.style.bottom = "12px";
    el.style.zIndex = "999999";
    el.style.background = "rgba(0,0,0,0.85)";
    el.style.color = "white";
    el.style.padding = "8px 10px";
    el.style.borderRadius = "10px";
    el.style.fontSize = "12px";
    el.style.maxWidth = "320px";
    el.style.pointerEvents = "none";
    document.documentElement.appendChild(el);
  }
  el.textContent = msg;
  setTimeout(() => el && el.remove(), 2000);
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["settings"], (data) => {
      const s = data.settings || {};
      resolve({
        enabled: s.enabled !== false, // default ON
        enableNotifications: s.enableNotifications !== false, // default ON
        enableSound: s.enableSound === true, // default OFF
        debug: s.debug === true, // default OFF
        alertOnFirstDetection: s.alertOnFirstDetection === true // default OFF
      });
    });
  });
}

function getStoredChannelState(channel) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["channels"], (data) => {
      const channels = data.channels || {};
      resolve(channels[channel] || {});
    });
  });
}

function setStoredChannelState(channel, patch) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["channels"], (data) => {
      const channels = data.channels || {};
      channels[channel] = { ...(channels[channel] || {}), ...patch };
      chrome.storage.local.set({ channels }, () => resolve());
    });
  });
}

function canAlert(now, value) {
  // Avoid duplicate spam if Twitch rerenders
  return (
    (now - lastAlertAt) > DUPLICATE_COOLDOWN_MS || lastAlertValue !== value
  );
}

async function fireAlert({ channel, oldValue, newValue, settings, now, state }) {
  lastAlertAt = now;
  lastAlertValue = newValue;

  if (settings.enableSound) playBeep();

  if (settings.enableNotifications) {
    chrome.runtime.sendMessage({
      type: "STREAK_INCREASED",
      channel,
      oldValue,
      newValue
    });
  }

  // history
  const history = Array.isArray(state.history) ? state.history : [];
  history.push({ at: now, from: oldValue, to: newValue });
  await setStoredChannelState(channel, { history });
}

async function checkStreak() {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_THROTTLE_MS) return;
  lastCheckAt = now;

  const channel = getChannelFromPath();
  if (!channel) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  const value = findStreakValueInDOM();

  if (settings.debug) {
    debugToast(
      value === null
        ? `No streak detected (open the streak widget)`
        : `Detected streak: ${value} (${channel})`
    );
  }

  if (typeof value !== "number" || Number.isNaN(value)) return;

  const state = await getStoredChannelState(channel);
  const prev = typeof state.lastValue === "number" ? state.lastValue : null;

  // Always store latest seen value + time
  await setStoredChannelState(channel, {
    lastSeenAt: now,
    lastValue: value
  });

  // FIRST TIME seeing a value for this channel
  if (prev === null) {
    if (settings.alertOnFirstDetection && canAlert(now, value)) {
      // Use oldValue = value to indicate "detected"
      await fireAlert({
        channel,
        oldValue: value,
        newValue: value,
        settings,
        now,
        state
      });
    }
    return;
  }

  // Only alert on increase
  if (value > prev) {
    if (!canAlert(now, value)) return;

    await fireAlert({
      channel,
      oldValue: prev,
      newValue: value,
      settings,
      now,
      state
    });
  }
}

// Observe DOM changes
const observer = new MutationObserver(() => checkStreak());
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true
});

// Light polling fallback
setInterval(checkStreak, 3000);

// Initial check after load
setTimeout(checkStreak, 1500);