chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "STREAK_INCREASED") return;

  const { channel, oldValue, newValue } = msg;

  chrome.storage.local.get(["settings"], (data) => {
    const settings = data.settings || {};
    const enabled = settings.enabled !== false; // default ON
    const enableNotifications = settings.enableNotifications !== false; // default ON

    if (!enabled || !enableNotifications) return;

    chrome.notifications.create(
      `streak-${channel}-${Date.now()}`,
      {
        type: "basic",
        // If you add icons later, update this:
        iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ajh6GQAAAAASUVORK5CYII=",
        title: "Twitch Watch Streak Increased!",
        message: `${channel}: ${oldValue} → ${newValue}`,
        priority: 2
      }
    );
  });
});