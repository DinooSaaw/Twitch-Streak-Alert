// Twitch Watch Streak Alerts - Content Script (MV3)

const STREAK_LABEL = "Your Watch Streak:";
const CHECK_THROTTLE_MS = 800;
const DUPLICATE_COOLDOWN_MS = 30_000;
const HUD_ID = "streak-alert-hud";
const HUD_MARGIN = 16;
const HUD_DEFAULT_VISIBLE_MS = 60_000;
const MENU_TOGGLE_COOLDOWN_MS = 1500;

let lastCheckAt = 0;
let lastAttachAt = 0;
let lastAlertAt = 0;
let lastAlertValue = null;

let hudEl = null;
let hudTitleEl = null;
let hudSubtitleEl = null;
let hudChannelEl = null;
let hudHost = null;
let hudPosition = null;
let loadedHudPositionChannel = null;
let dragEnabled = false;
let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let hudHideTimer = null;
let currentHudVisibleMs = HUD_DEFAULT_VISIBLE_MS;
let autoMenuOpenedByExtension = false;
let autoMenuChannel = null;
let lastMenuToggleAt = 0;
const DEBUG_HIGHLIGHT_ATTR = "data-streak-alert-debug-highlight";

function getChannelFromPath() {
  const path = location.pathname.split("/").filter(Boolean);
  if (!path.length) return null;

  // Moderator URL parsing: /moderator/{channel} maps to channel key {channel}
  // so streak storage is shared with /{channel}.
  if (path[0].toLowerCase() === "moderator") {
    return path[1] ? path[1].toLowerCase() : null;
  }

  const candidate = path[0].toLowerCase();
  const blocked = new Set([
    "directory", "videos", "settings", "downloads", "turbo", "wallet", "subscriptions",
    "inventory", "friends", "messages", "search", "jobs", "p", "user", "creatorcamp", "prime"
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
  const m = t.match(/Your Watch Streak:\s*(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function findStreakValueInDOM() {
  const matches = [];

  const ps = document.querySelectorAll("p");
  for (const p of ps) {
    const txt = p.textContent || "";
    if (txt.includes(STREAK_LABEL)) {
      const v = parseStreakFromText(txt);
      if (v !== null) matches.push({ v, len: txt.length });
    }
  }
  if (matches.length) {
    matches.sort((a, b) => a.len - b.len);
    return matches[0].v;
  }

  const els = document.querySelectorAll("span, div, em, button");
  for (const el of els) {
    const txt = el.textContent || "";
    if (txt.includes(STREAK_LABEL)) {
      const v = parseStreakFromText(txt);
      if (v !== null) matches.push({ v, len: txt.length });
    }
  }
  if (matches.length) {
    matches.sort((a, b) => a.len - b.len);
    return matches[0].v;
  }

  const ariaEls = document.querySelectorAll("[aria-label]");
  for (const el of ariaEls) {
    const aria = el.getAttribute("aria-label") || "";
    if (aria.includes(STREAK_LABEL)) {
      const v = parseStreakFromText(aria);
      if (v !== null) return v;
    }
  }

  const icon = document.querySelector('svg[aria-label="Watch Streak"]');
  if (icon) {
    const root = icon.closest("div") || icon.parentElement;
    const blob = root?.textContent || "";
    const v = parseStreakFromText(blob);
    if (v !== null) return v;
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
  } catch {}
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["settings"], (data) => {
      const s = data.settings || {};
      const parsedSeconds = Number(s.hudVisibleSeconds);
      const parsedMs = Number(s.hudVisibleMs);
      let hudVisibleMs = HUD_DEFAULT_VISIBLE_MS;
      if (Number.isFinite(parsedMs) && parsedMs > 0) hudVisibleMs = parsedMs;
      else if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) hudVisibleMs = parsedSeconds * 1000;

      resolve({
        enabled: s.enabled !== false,
        enableNotifications: s.enableNotifications !== false,
        enableSound: s.enableSound === true,
        debug: s.debug === true,
        alertOnFirstDetection: s.alertOnFirstDetection === true,
        autoOpenCloseMenu: s.autoOpenCloseMenu === true,
        hudVisibleMs
      });
    });
  });
}

function getStoredChannelState(channel) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["channels"], (data) => {
      resolve((data.channels || {})[channel] || {});
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
  return (now - lastAlertAt) > DUPLICATE_COOLDOWN_MS || lastAlertValue !== value;
}

async function pushHistoryEvent(channel, state, event) {
  const history = Array.isArray(state.history) ? state.history : [];
  history.push(event);
  await setStoredChannelState(channel, { history });
}

async function fireAlert({ channel, oldValue, newValue, settings, now, state, kind }) {
  lastAlertAt = now;
  lastAlertValue = newValue;

  if (settings.enableSound) playBeep();

  if (settings.enableNotifications) {
    chrome.runtime.sendMessage({
      type: "STREAK_INCREASED",
      channel,
      oldValue,
      newValue,
      kind
    });
  }

  await pushHistoryEvent(channel, state, { at: now, from: oldValue, to: newValue, kind });
}

function clampHudPosition(x, y) {
  const w = hudEl?.offsetWidth || 220;
  const h = hudEl?.offsetHeight || 68;
  return {
    x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)),
    y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h))
  };
}

function isWatchStreakToggleCandidate(el) {
  const text = normalizeSpaces(
    `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.textContent || ""}`
  ).toLowerCase();
  return text.includes("watch streak");
}

function isElementVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function pickBottomRightElement(elements) {
  const visible = elements.filter((el) => isElementVisible(el));
  if (!visible.length) return null;
  return visible.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const sa = (ra.left + ra.width) + (ra.top + ra.height) * 2;
    const sb = (rb.left + rb.width) + (rb.top + rb.height) * 2;
    return sb - sa;
  })[0];
}

function isWatchStreakMenuVisible() {
  const nodes = document.querySelectorAll("p, div, span");
  for (const node of nodes) {
    const text = node.textContent || "";
    if (text.includes(STREAK_LABEL) && isElementVisible(node)) return true;
  }
  return false;
}

function findWatchStreakOpenButtonFromBalances() {
  const markers = document.querySelectorAll(
    '[data-test-selector="bits-balance-string"], [data-test-selector="copo-balance-string"]'
  );
  const buttons = [];
  for (const marker of markers) {
    const btn = marker.closest("button, [role='button']");
    if (btn) buttons.push(btn);
  }
  return pickBottomRightElement(buttons);
}

function findWatchStreakCloseButton() {
  const closeButtons = Array.from(document.querySelectorAll(
    'button[aria-label="Close"], [role="button"][aria-label="Close"]'
  ));
  return pickBottomRightElement(closeButtons);
}

function findToggleFromWatchStreakIcon() {
  const icon = document.querySelector('svg[aria-label="Watch Streak"]');
  if (!icon) return null;
  const button = icon.closest("button, [role='button']");
  return button && isElementVisible(button) ? button : null;
}

function findToggleNearSettingsRow() {
  const settingsButtons = [];

  const byAria = document.querySelectorAll(
    'button[aria-label*="Settings"], [role="button"][aria-label*="Settings"]'
  );
  for (const el of byAria) {
    if (isElementVisible(el)) settingsButtons.push(el);
  }

  const byIcon = document.querySelectorAll('svg[aria-label="Settings"]');
  for (const icon of byIcon) {
    const btn = icon.closest("button, [role='button']");
    if (btn && isElementVisible(btn)) settingsButtons.push(btn);
  }

  if (!settingsButtons.length) return null;

  // Prefer the settings button located in the chat area (bottom-right-ish).
  const pickSettings = [...new Set(settingsButtons)].sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const sa = (ra.left + ra.width) + (ra.top + ra.height) * 2;
    const sb = (rb.left + rb.width) + (rb.top + rb.height) * 2;
    return sb - sa;
  })[0];
  if (!pickSettings?.parentElement) return null;

  const siblings = Array.from(pickSettings.parentElement.children)
    .filter((node) => node instanceof HTMLElement)
    .filter((node) => node.matches("button, [role='button']"))
    .filter((node) => isElementVisible(node));
  if (!siblings.length) return null;

  const settingsIdx = siblings.indexOf(pickSettings);
  if (settingsIdx <= 0) return null;

  // Use the immediate button to the left of chat settings gear.
  return siblings[settingsIdx - 1] || null;
}

function findWatchStreakToggle() {
  const byBalances = findWatchStreakOpenButtonFromBalances();
  if (byBalances) return byBalances;

  const byIcon = findToggleFromWatchStreakIcon();
  if (byIcon) return byIcon;

  const direct = document.querySelector(
    'button[aria-label*="Watch Streak"], [role="button"][aria-label*="Watch Streak"]'
  );
  if (direct) return direct;

  const candidates = document.querySelectorAll("button, [role='button']");
  for (const el of candidates) {
    if (isWatchStreakToggleCandidate(el)) return el;
  }

  const byRowFallback = findToggleNearSettingsRow();
  if (byRowFallback) return byRowFallback;
  return null;
}

function collectWatchStreakToggleCandidates() {
  const out = [];
  const seen = new Set();
  const push = (el) => {
    if (!el || seen.has(el) || !isElementVisible(el)) return;
    seen.add(el);
    out.push(el);
  };

  push(findWatchStreakOpenButtonFromBalances());
  push(findToggleFromWatchStreakIcon());

  const direct = document.querySelector(
    'button[aria-label*="Watch Streak"], [role="button"][aria-label*="Watch Streak"]'
  );
  push(direct);

  const byRow = findToggleNearSettingsRow();
  push(byRow);

  const candidates = document.querySelectorAll("button, [role='button']");
  for (const el of candidates) {
    if (isWatchStreakToggleCandidate(el)) push(el);
  }

  return out;
}

function findWatchStreakToggleCandidates() {
  const matches = [];
  const seen = new Set();
  const byBalances = findWatchStreakOpenButtonFromBalances();
  if (byBalances) {
    matches.push(byBalances);
    seen.add(byBalances);
  }

  const direct = document.querySelector(
    'button[aria-label*="Watch Streak"], [role="button"][aria-label*="Watch Streak"]'
  );
  if (direct) {
    matches.push(direct);
    seen.add(direct);
  }

  const candidates = document.querySelectorAll("button, [role='button']");
  for (const el of candidates) {
    if (!seen.has(el) && isWatchStreakToggleCandidate(el)) {
      matches.push(el);
      seen.add(el);
    }
  }
  return matches;
}

function clearDebugButtonHighlights() {
  const highlighted = document.querySelectorAll(`[${DEBUG_HIGHLIGHT_ATTR}="1"]`);
  for (const el of highlighted) {
    el.style.outline = "";
    el.style.outlineOffset = "";
    el.style.boxShadow = "";
    el.removeAttribute(DEBUG_HIGHLIGHT_ATTR);
  }
}

function syncDebugButtonHighlights(enabled) {
  if (!enabled) {
    clearDebugButtonHighlights();
    return;
  }

  const buttons = findWatchStreakToggleCandidates();
  if (!buttons.length) {
    clearDebugButtonHighlights();
    return;
  }

  for (const el of buttons) {
    el.style.outline = "2px solid rgba(255, 186, 73, 0.95)";
    el.style.outlineOffset = "2px";
    el.style.boxShadow = "0 0 0 2px rgba(145, 71, 255, 0.45)";
    el.setAttribute(DEBUG_HIGHLIGHT_ATTR, "1");
  }
}

function getExpandedState(el) {
  const v = el.getAttribute("aria-expanded");
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function simulateUserClick(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const clientX = Math.round(rect.left + rect.width / 2);
  const clientY = Math.round(rect.top + rect.height / 2);
  const mouseInit = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 };

  try {
    if (typeof PointerEvent === "function") {
      el.dispatchEvent(new PointerEvent("pointerdown", { ...mouseInit, pointerType: "mouse", isPrimary: true }));
    }
    el.dispatchEvent(new MouseEvent("mousedown", mouseInit));
    if (typeof PointerEvent === "function") {
      el.dispatchEvent(new PointerEvent("pointerup", { ...mouseInit, pointerType: "mouse", isPrimary: true }));
    }
    el.dispatchEvent(new MouseEvent("mouseup", mouseInit));
    el.dispatchEvent(new MouseEvent("click", mouseInit));
    return true;
  } catch {
    try {
      el.click();
      return true;
    } catch {
      return false;
    }
  }
}

function setWatchStreakMenuOpen(targetOpen) {
  if (targetOpen && isWatchStreakMenuVisible()) return true;
  if (!targetOpen && !isWatchStreakMenuVisible()) return true;

  const now = Date.now();
  if (now - lastMenuToggleAt < MENU_TOGGLE_COOLDOWN_MS) return false;

  if (targetOpen) {
    const toggles = collectWatchStreakToggleCandidates();
    if (!toggles.length) {
      const fallback = findWatchStreakToggle();
      if (fallback) toggles.push(fallback);
    }
    if (!toggles.length) return false;

    for (const toggle of toggles) {
      const expanded = getExpandedState(toggle);
      if (expanded === true) return true;
      if (simulateUserClick(toggle)) {
        lastMenuToggleAt = now;
        break;
      }
    }
    return isWatchStreakMenuVisible();
  }

  const closeButton = findWatchStreakCloseButton();
  if (closeButton) {
    if (simulateUserClick(closeButton)) lastMenuToggleAt = now;
    return !isWatchStreakMenuVisible();
  }

  // Fallback close: only click an already-expanded toggle.
  const fallbackToggle = findWatchStreakToggle();
  if (!fallbackToggle) return false;
  const expanded = getExpandedState(fallbackToggle);
  if (expanded === true && simulateUserClick(fallbackToggle)) {
    lastMenuToggleAt = now;
  }
  return !isWatchStreakMenuVisible();
}

function createHud() {
  const existing = document.querySelectorAll(`#${HUD_ID}`);
  if (existing.length > 1) {
    for (let i = 1; i < existing.length; i++) existing[i].remove();
  }

  if (hudEl && document.contains(hudEl)) return hudEl;

  const el = document.createElement("div");
  el.id = HUD_ID;
  el.setAttribute("aria-live", "polite");
  el.style.position = "fixed";
  el.style.left = "0px";
  el.style.top = "0px";
  el.style.zIndex = "2147483646";
  el.style.minWidth = "170px";
  el.style.maxWidth = "280px";
  el.style.padding = "8px 10px";
  el.style.borderRadius = "12px";
  el.style.color = "#ffffff";
  el.style.background = "rgba(14, 14, 17, 0.74)";
  el.style.border = "1px solid rgba(145, 71, 255, 0.58)";
  el.style.backdropFilter = "blur(4px)";
  el.style.boxShadow = "0 10px 28px rgba(0, 0, 0, 0.34)";
  el.style.fontFamily = "Inter, Segoe UI, system-ui, sans-serif";
  el.style.fontSize = "13px";
  el.style.lineHeight = "1.35";
  el.style.pointerEvents = "auto";
  el.style.cursor = "grab";
  el.style.userSelect = "none";
  el.style.opacity = "0";
  el.style.transform = "translateY(0) scale(0.97)";
  el.style.transition = "opacity 220ms ease, transform 220ms ease, border-color 280ms ease, box-shadow 280ms ease";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.display = "flex";
  title.style.alignItems = "center";
  title.style.gap = "6px";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("width", "14");
  icon.setAttribute("height", "14");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.style.display = "inline-block";
  icon.style.verticalAlign = "middle";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute(
    "d",
    "M5.295 8.05 10 2l3 4 2-3 3.8 5.067a11 11 0 0 1 2.2 6.6A7.333 7.333 0 0 1 13.667 22h-3.405A7.262 7.262 0 0 1 3 14.738c0-2.423.807-4.776 2.295-6.688Zm7.801 1.411 2-3L17.2 9.267a9 9 0 0 1 1.8 5.4 5.334 5.334 0 0 1-4.826 5.31 3 3 0 0 0 .174-3.748L12 13l-2.348 3.229a3 3 0 0 0 .18 3.754A5.263 5.263 0 0 1 5 14.738c0-1.978.66-3.9 1.873-5.46l3.098-3.983 3.125 4.166Z"
  );
  path.setAttribute("clip-rule", "evenodd");
  icon.appendChild(path);

  const titleText = document.createElement("span");
  title.appendChild(icon);
  title.appendChild(titleText);

  const subtitle = document.createElement("div");
  subtitle.style.fontSize = "12px";
  subtitle.style.opacity = "0.88";
  subtitle.style.marginTop = "2px";
  subtitle.style.whiteSpace = "nowrap";

  const channel = document.createElement("div");
  channel.style.fontSize = "11px";
  channel.style.opacity = "0.7";
  channel.style.marginTop = "4px";

  el.appendChild(title);
  el.appendChild(subtitle);
  el.appendChild(channel);

  hudEl = el;
  hudTitleEl = titleText;
  hudSubtitleEl = subtitle;
  hudChannelEl = channel;
  return el;
}

function clearHudHideTimer() {
  if (!hudHideTimer) return;
  clearTimeout(hudHideTimer);
  hudHideTimer = null;
}

function hideHud() {
  if (!hudEl) return;
  hudEl.style.opacity = "0";
  hudEl.style.transform = "translateY(0) scale(0.97)";
}

function scheduleHudHide(delayMs) {
  clearHudHideTimer();
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  hudHideTimer = setTimeout(() => {
    if (dragging) {
      scheduleHudHide(800);
      return;
    }
    hideHud();
  }, delayMs);
}

function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function syncHudFullscreenVisibility() {
  if (!hudEl) return;
  if (isFullscreenActive()) {
    hudEl.style.display = "none";
    clearHudHideTimer();
  } else {
    hudEl.style.display = "block";
  }
}

function updateHud({ title, subtitle, mode, channel }) {
  const el = createHud();
  syncHudFullscreenVisibility();
  hudTitleEl.textContent = title || "";
  hudSubtitleEl.textContent = subtitle || "";
  hudSubtitleEl.style.display = subtitle ? "block" : "none";
  hudChannelEl.textContent = channel ? channel : "";
  hudChannelEl.style.display = channel ? "block" : "none";

  if (isFullscreenActive()) return;

  el.style.opacity = "1";
  el.style.transform = "translateY(0) scale(1)";
  el.style.borderColor = "rgba(145, 71, 255, 0.58)";
  el.style.boxShadow = "0 10px 28px rgba(0, 0, 0, 0.34)";

  if (mode === "increase") {
    el.style.borderColor = "rgba(255, 186, 73, 0.88)";
    el.style.boxShadow = "0 0 0 2px rgba(145, 71, 255, 0.26), 0 10px 30px rgba(145, 71, 255, 0.42)";
    el.style.transform = "translateY(0) scale(1.04)";
    setTimeout(() => {
      if (!hudEl) return;
      hudEl.style.transform = "translateY(0) scale(1)";
      hudEl.style.borderColor = "rgba(145, 71, 255, 0.58)";
      hudEl.style.boxShadow = "0 10px 28px rgba(0, 0, 0, 0.34)";
    }, 300);
  } else {
    el.style.transform = "translateY(0) scale(1.015)";
    setTimeout(() => {
      if (!hudEl) return;
      hudEl.style.transform = "translateY(0) scale(1)";
    }, 210);
  }

  scheduleHudHide(currentHudVisibleMs);
}

function findPlayerContainer() {
  // Player container detection: Twitch changes wrappers often, so we try
  // multiple selectors before falling back to the video parent chain.
  const selectors = [
    '[data-a-target="video-player"]',
    ".video-player",
    ".tw-player",
    '[data-test-selector="video-player"]',
    ".persistent-player"
  ];
  for (const sel of selectors) {
    const node = document.querySelector(sel);
    if (node) return node;
  }

  const video = document.querySelector("video");
  let parent = video?.parentElement || null;
  let steps = 0;
  while (parent && steps < 6) {
    const rect = parent.getBoundingClientRect();
    if (rect.width > 220 && rect.height > 120) return parent;
    parent = parent.parentElement;
    steps += 1;
  }
  return null;
}

function applyHudPosition() {
  if (!hudEl || !hudPosition) return;
  hudPosition = clampHudPosition(hudPosition.x, hudPosition.y);

  if (!hudHost || !hudHost.isConnected || hudHost === document.body || hudHost === document.documentElement) {
    hudEl.style.position = "fixed";
    hudEl.style.left = `${hudPosition.x}px`;
    hudEl.style.top = `${hudPosition.y}px`;
    return;
  }

  const rect = hudHost.getBoundingClientRect();
  hudEl.style.position = "absolute";
  hudEl.style.left = `${Math.round(hudPosition.x - rect.left)}px`;
  hudEl.style.top = `${Math.round(hudPosition.y - rect.top)}px`;
}

async function loadHudPosition(channel) {
  return new Promise((resolve) => {
    // Storage logic: channel-specific position first, then global position.
    chrome.storage.local.get(["hudPosition", "hudPositionByChannel"], (data) => {
      const byChannel = data.hudPositionByChannel || {};
      const global = data.hudPosition?.global || null;
      resolve(byChannel[channel] || global || null);
    });
  });
}

async function saveHudPosition(channel) {
  if (!hudPosition || !channel) return;
  return new Promise((resolve) => {
    // Storage logic: save to both `hudPosition.global` and per-channel map.
    chrome.storage.local.get(["hudPosition", "hudPositionByChannel"], (data) => {
      const hudPositionStore = data.hudPosition || {};
      const byChannel = data.hudPositionByChannel || {};
      const clamped = clampHudPosition(hudPosition.x, hudPosition.y);
      hudPositionStore.global = clamped;
      byChannel[channel] = clamped;
      chrome.storage.local.set({
        hudPosition: hudPositionStore,
        hudPositionByChannel: byChannel
      }, () => resolve());
    });
  });
}

async function attachHud(channel) {
  const el = createHud();
  const targetHost = findPlayerContainer() || document.body || document.documentElement;

  if (el.parentElement !== targetHost) targetHost.appendChild(el);
  hudHost = targetHost;

  if (targetHost !== document.body && targetHost !== document.documentElement) {
    const style = getComputedStyle(targetHost);
    if (style.position === "static") targetHost.style.position = "relative";
  }

  if (loadedHudPositionChannel !== channel) {
    loadedHudPositionChannel = channel;
    hudPosition = await loadHudPosition(channel);
  }

  if (!hudPosition) {
    const rect = targetHost.getBoundingClientRect?.() || { left: 0, top: 0 };
    hudPosition = clampHudPosition(
      Math.round((rect.left || 0) + HUD_MARGIN),
      Math.round((rect.top || 0) + HUD_MARGIN)
    );
  }

  applyHudPosition();
}

function enableDrag() {
  if (dragEnabled) return;
  dragEnabled = true;

  document.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (!hudEl || !hudEl.isConnected) return;
    const rect = hudEl.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) return;

    dragging = true;
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;

    // Drag logic: HUD remains interactive for reliable drag start.
    clearHudHideTimer();
    hudEl.style.cursor = "grabbing";
    event.preventDefault();
    event.stopPropagation();
  }, true);

  document.addEventListener("mousemove", (event) => {
    if (!dragging || !hudEl) return;
    const x = event.clientX - dragOffsetX;
    const y = event.clientY - dragOffsetY;
    hudPosition = clampHudPosition(x, y);
    applyHudPosition();
  }, true);

  document.addEventListener("mouseup", async () => {
    if (!dragging || !hudEl) return;
    dragging = false;
    hudEl.style.cursor = "grab";
    const channel = getChannelFromPath();
    if (channel) await saveHudPosition(channel);
    if (!isFullscreenActive()) scheduleHudHide(currentHudVisibleMs);
  }, true);

  window.addEventListener("resize", () => {
    if (!hudPosition) return;
    hudPosition = clampHudPosition(hudPosition.x, hudPosition.y);
    applyHudPosition();
  });
}

async function checkStreak() {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_THROTTLE_MS) return;
  lastCheckAt = now;

  const channel = getChannelFromPath();
  if (!channel) return;

  if (autoMenuChannel !== channel) {
    autoMenuChannel = channel;
    autoMenuOpenedByExtension = false;
  }

  const settings = await getSettings();
  if (!settings.enabled) return;
  currentHudVisibleMs = settings.hudVisibleMs;

  if (now - lastAttachAt > 500) {
    lastAttachAt = now;
    await attachHud(channel);
  }

  if (settings.autoOpenCloseMenu && !autoMenuOpenedByExtension) {
    if (setWatchStreakMenuOpen(true) || isWatchStreakMenuVisible()) autoMenuOpenedByExtension = true;
  }
  syncDebugButtonHighlights(settings.debug);

  const value = findStreakValueInDOM();
  if (typeof value !== "number" || Number.isNaN(value)) return;

  const state = await getStoredChannelState(channel);
  const prev = typeof state.lastValue === "number" ? state.lastValue : null;

  await setStoredChannelState(channel, { lastSeenAt: now, lastValue: value });

  if (prev === null) {
    if (settings.alertOnFirstDetection && canAlert(now, value)) {
      await fireAlert({ channel, oldValue: value, newValue: value, settings, now, state, kind: "first" });
      updateHud({
        title: `Detected streak: ${value}`,
        subtitle: "",
        mode: "first",
        channel
      });
      return;
    }
    if (settings.debug) {
      updateHud({
        title: `Watch Streak: ${value}`,
        subtitle: "Detected",
        mode: "detect",
        channel
      });
    }
    return;
  }

  if (value > prev) {
    if (!canAlert(now, value)) return;
    await fireAlert({ channel, oldValue: prev, newValue: value, settings, now, state, kind: "increase" });
    updateHud({
      title: `Watch Streak: ${value}`,
      subtitle: `\u2191 ${prev} \u2192 ${value}`,
      mode: "increase",
      channel
    });
    if (settings.autoOpenCloseMenu && autoMenuOpenedByExtension) {
      setWatchStreakMenuOpen(false);
      autoMenuOpenedByExtension = false;
    }
    return;
  }

  if (value < prev) {
    await pushHistoryEvent(channel, state, { at: now, from: prev, to: value, kind: "decrease" });
  }

  if (settings.debug) {
    updateHud({
      title: `Watch Streak: ${value}`,
      subtitle: "Detected",
      mode: "detect",
      channel
    });
  }
}

enableDrag();

document.addEventListener("fullscreenchange", syncHudFullscreenVisibility, true);
document.addEventListener("webkitfullscreenchange", syncHudFullscreenVisibility, true);

// Rerender handling: observe DOM changes and reattach HUD if player wrappers are replaced.
const observer = new MutationObserver(() => {
  checkStreak();
  syncHudFullscreenVisibility();
  const channel = getChannelFromPath();
  if (!channel || !hudEl) return;
  if (!hudHost || !hudHost.isConnected || !document.contains(hudEl)) {
    attachHud(channel);
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

setInterval(checkStreak, 3000);
setTimeout(checkStreak, 1200);

console.log("[StreakAlerts] content.js loaded on", location.href);
