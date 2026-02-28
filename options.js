const els = {
  enabled: document.getElementById("enabled"),
  enableNotifications: document.getElementById("enableNotifications"),
  enableSound: document.getElementById("enableSound"),
  alertOnFirstDetection: document.getElementById("alertOnFirstDetection"),
  debug: document.getElementById("debug"),
  reset: document.getElementById("reset"),
  status: document.getElementById("status")
};

function setStatus(msg) {
  els.status.textContent = msg;
  setTimeout(() => (els.status.textContent = ""), 1800);
}

function load() {
  chrome.storage.local.get(["settings"], (data) => {
    const s = data.settings || {};
    els.enabled.checked = s.enabled !== false; // default ON
    els.enableNotifications.checked = s.enableNotifications !== false; // default ON
    els.enableSound.checked = s.enableSound === true; // default OFF
    els.alertOnFirstDetection.checked = s.alertOnFirstDetection === true; // default OFF
    els.debug.checked = s.debug === true; // default OFF
  });
}

function save() {
  const settings = {
    enabled: els.enabled.checked,
    enableNotifications: els.enableNotifications.checked,
    enableSound: els.enableSound.checked,
    alertOnFirstDetection: els.alertOnFirstDetection.checked,
    debug: els.debug.checked
  };
  chrome.storage.local.set({ settings }, () => setStatus("Saved."));
}

els.enabled.addEventListener("change", save);
els.enableNotifications.addEventListener("change", save);
els.enableSound.addEventListener("change", save);
els.alertOnFirstDetection.addEventListener("change", save);
els.debug.addEventListener("change", save);

els.reset.addEventListener("click", () => {
  chrome.storage.local.set({ channels: {} }, () => setStatus("Reset complete."));
});

load();