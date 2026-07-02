# Speechify - Selection Reader 🎙️📖

Speechify is a premium Chrome Extension that reads selected webpage text aloud. It features high-quality browser voices, premium real-time word highlighting, and an interactive **Voice Studio Dashboard** in the side panel.

---

## ✨ Features

- **Text-to-Speech Selection**: Highlight any text on a web page, right-click, and select **"Read selection with Speechify"** to start listening.
- **Voice Studio Side Panel**: Keep your dashboard active while browsing. Access control settings, choose voices, and monitor reading progress seamlessly.
- **Full Playback Controls**:
  - Play & Pause
  - Skip Forward / Backward sentence-by-sentence
  - Stop reading
- **Variable Reading Speed**: Fine-tune the audio speed between **0.5x** (slower) and **3.0x** (faster) with a slider.
- **Rich Voice Catalog**:
  - Filter voices by languages (English, Spanish, French, German, Italian, and more).
  - Search box to quickly locate specific speech engines.
  - Interactive test/preview buttons for each voice.
- **Smart Highlighting**: Watch sentences and words highlight in real-time on the webpage as the TTS reader speaks.

---

## 🛠️ Installation (Developer Mode)

Since this extension is in development, you can load it locally into Google Chrome:

1. **Download / Clone** this repository to your local machine.
2. Open Google Chrome and go to the Extensions page: `chrome://extensions/`
3. In the top-right corner, toggle the **"Developer mode"** switch to **ON**.
4. Click the **"Load unpacked"** button in the top-left corner.
5. Select the main project folder (`Speechify`) containing `manifest.json`.

*You're all set! You will see the **Speechify - Selection Reader** icon in your toolbar.*

---

## 🚀 How to Use

1. Click the **Speechify extension icon** in your toolbar to open the **Voice Studio Side Panel**.
2. Select a voice from the catalog (e.g., search for Google US English or filter by your preferred language).
3. Select any text on a website, right-click it, and click **"Read selection with Speechify"**.
4. Use the playback bar at the top of the side panel to control pause/play, skip sentences, or change the speech rate.

---

## 📂 Project Structure

```
├── manifest.json       # Chrome extension metadata and permissions
├── background.js       # Service worker managing context menus and panel interactions
├── generate_icons.js   # Script to generate extension icon assets
├── content/
│   ├── content.js      # Page script that highlights words/sentences in real-time
│   └── content.css     # Styling for active highlights on web pages
├── sidepanel/
│   ├── sidepanel.html  # Voice Studio panel layout
│   ├── sidepanel.css   # Modern dashboard theme stylesheet
│   └── sidepanel.js    # Logic for audio playback, catalog search, and filtering
└── icons/
    ├── icon16.png      # Extension icon (small)
    ├── icon48.png      # Extension icon (medium)
    └── icon128.png     # Extension icon (large)
```

---

## 📜 License

This project is licensed under the terms of the Apache 2 License. See the LICENSE file for more details.
