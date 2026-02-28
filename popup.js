const enabledText = document.getElementById("enabledText");
const notifText = document.getElementById("notifText");
const soundText = document.getElementById("soundText");
const firstText = document.getElementById("firstText");
const openSettings = document.getElementById("openSettings");

chrome.storage.local.get(["settings"], (data) => {
  const s = data.settings || {};
  enabledText.textContent = (s.enabled !== false) ? "ON" : "OFF";
  notifText.textContent = (s.enableNotifications !== false) ? "ON" : "OFF";
  soundText.textContent = (s.enableSound === true) ? "ON" : "OFF";
  firstText.textContent = (s.alertOnFirstDetection === true) ? "ON" : "OFF";
});

openSettings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});