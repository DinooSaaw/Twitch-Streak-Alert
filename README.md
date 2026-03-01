# Twitch Watch Streak Alerts

Chrome extension that tracks Twitch watch streak values per channel and alerts you when a streak increases.

## Features

- Detects `Your Watch Streak: X` from Twitch channel pages.
- Stores streak history per channel using `chrome.storage.local`.
- Sends desktop notifications on streak increase.
- Optional sound alert (beep) on streak increase.
- Optional alert on first streak detection for a channel.
- Optional auto open/close of the Watch Streak menu.
- Popup dashboard for current channel and tracked channels.
- Settings page with toggles, HUD timeout, and reset.

## Install (Developer Mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `Twitch-Streak-Alert`.

## Usage

1. Open a Twitch channel page (for example `https://www.twitch.tv/<channel>`).
2. Open the Watch Streak widget/menu at least once so the value can be detected.
3. Leave the extension enabled; it will track and alert on increases.
4. Use the extension popup to see current/tracked channels.
5. Use **Open Settings** to configure notifications, sound, and other behavior.

## Permissions

- `storage`: save settings and tracked channel streak data locally.
- `notifications`: show desktop alerts.
- `*://*.twitch.tv/*`: read watch streak text on Twitch pages.

## Privacy

All data is stored locally in your browser (`chrome.storage.local`).  
No external backend is used by this extension.

## Tech

- Manifest V3
- Vanilla JavaScript, HTML, CSS
