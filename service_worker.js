chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "STREAK_INCREASED") return;

  const { channel, oldValue, newValue, kind } = msg;

  chrome.storage.local.get(["settings"], (data) => {
    const settings = data.settings || {};
    const enabled = settings.enabled !== false;
    const enableNotifications = settings.enableNotifications !== false;

    if (!enabled || !enableNotifications) return;

    const message =
      kind === "first"
        ? `${channel}: Detected watch streak ${newValue}`
        : `${channel}: ${oldValue} → ${newValue}`;

    chrome.notifications.create(
      `streak-${channel}-${Date.now()}`,
      {
        type: "basic",
        iconUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ajh6GQAAAAASUVORK5CYII=",
        title: "Twitch Watch Streak",
        message,
        priority: 2
      }
    );
  });
});