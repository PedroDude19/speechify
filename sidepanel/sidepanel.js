// sidepanel.js - Speechify Voice Studio Controller

let allVoices = [];
let selectedVoiceName = null;
let currentLanguageFilter = "all";
let searchQuery = "";
let currentPlaybackState = {
  isPlaying: false,
  isPaused: false,
  sentencesCount: 0,
  sentenceIndex: 0,
  currentSentenceText: "",
  selectedText: ""
};

let previewingVoiceName = null;

// Initialize Sidepanel
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  loadInitialSettings();
  initVoiceLoader();
  syncWithActiveTab();
});

// 1. Load settings from storage
function loadInitialSettings() {
  chrome.storage.local.get(["activeVoiceName", "speechRate"], (result) => {
    if (result.activeVoiceName) {
      selectedVoiceName = result.activeVoiceName;
    }
    if (result.speechRate) {
      const speed = parseFloat(result.speechRate);
      document.getElementById("panel-speed-slider").value = speed;
      document.getElementById("panel-speed-val").textContent = `${speed.toFixed(1)}x`;
    }
    renderVoiceList();
  });
}

// 2. Load SpeechSynthesis Voices
function initVoiceLoader() {
  function getVoices() {
    allVoices = window.speechSynthesis.getVoices();
    renderVoiceList();
  }
  
  // Try loading immediately
  getVoices();
  // Listen for async load events
  window.speechSynthesis.onvoiceschanged = getVoices;
}

// 3. Render Voice Catalog Cards
function renderVoiceList() {
  const container = document.getElementById("voice-list");
  if (!container) return;
  
  if (allVoices.length === 0) {
    container.innerHTML = `<div class="loading-state">Loading system voices...</div>`;
    return;
  }
  
  // Filter voices
  const filtered = allVoices.filter(voice => {
    // 1. Language Filter
    if (currentLanguageFilter !== "all") {
      if (!voice.lang.toLowerCase().startsWith(currentLanguageFilter)) {
        return false;
      }
    }
    
    // 2. Search query filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const nameMatch = voice.name.toLowerCase().includes(q);
      const langMatch = voice.lang.toLowerCase().includes(q);
      const engineMatch = voice.voiceURI.toLowerCase().includes(q);
      return nameMatch || langMatch || engineMatch;
    }
    
    return true;
  });
  
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">No voices match your search.</div>`;
    return;
  }
  
  // Sorting: Prioritize cloud voices (Google, Natural) and sort alphabetically
  filtered.sort((a, b) => {
    const aGoogle = a.name.includes("Google");
    const bGoogle = b.name.includes("Google");
    if (aGoogle && !bGoogle) return -1;
    if (!aGoogle && bGoogle) return 1;
    return a.name.localeCompare(b.name);
  });
  
  container.innerHTML = "";
  
  filtered.forEach(voice => {
    const isSelected = voice.name === selectedVoiceName;
    const isLocal = voice.localService;
    const isGoogle = voice.name.includes("Google");
    
    // Get clean engine tag
    let engineTag = "System";
    if (isGoogle) engineTag = "Google (Cloud)";
    else if (voice.name.includes("Natural")) engineTag = "Natural";
    else if (voice.name.includes("Microsoft")) engineTag = "Microsoft";
    
    // Create card
    const card = document.createElement("div");
    card.className = `voice-card ${isSelected ? "selected" : ""}`;
    card.setAttribute("data-voice-name", voice.name);
    
    // Format language display
    const langCode = voice.lang.replace('_', '-').split('-')[0].toUpperCase();
    const flagDisplay = voice.lang.split('-')[1] || langCode;
    
    card.innerHTML = `
      <div class="voice-info">
        <div class="voice-name-row">
          <span class="voice-name">${voice.name}</span>
          <span class="badge-lang" title="${voice.lang}">${langCode}-${flagDisplay}</span>
        </div>
        <div class="voice-meta">
          <span>Engine: <strong class="badge-engine">${engineTag}</strong></span>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-preview ${previewingVoiceName === voice.name ? "playing" : ""}" data-voice-name="${voice.name}" title="Preview Voice">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            ${previewingVoiceName === voice.name 
              ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' 
              : '<path d="M8 5v14l11-7z"/>'}
          </svg>
        </button>
        <div class="selected-indicator">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
      </div>
    `;
    
    // Select Voice Click Handler
    card.addEventListener("click", (e) => {
      // Avoid triggering when clicking preview button
      if (e.target.closest(".btn-preview")) return;
      
      selectVoice(voice.name);
    });
    
    // Preview Voice Click Handler
    const previewBtn = card.querySelector(".btn-preview");
    previewBtn.addEventListener("click", () => {
      triggerVoicePreview(voice, previewBtn);
    });
    
    container.appendChild(card);
  });
}

function selectVoice(name) {
  selectedVoiceName = name;
  chrome.storage.local.set({ activeVoiceName: name }, () => {
    // Re-render list to update checks
    renderVoiceList();
  });
}

// 4. Voice Preview Engine
function triggerVoicePreview(voice, btn) {
  if (previewingVoiceName === voice.name) {
    window.speechSynthesis.cancel();
    previewingVoiceName = null;
    btn.classList.remove("playing");
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    return;
  }
  
  // Stop all speech synthesis
  window.speechSynthesis.cancel();
  
  // Reset other preview buttons
  document.querySelectorAll(".btn-preview.playing").forEach(otherBtn => {
    otherBtn.classList.remove("playing");
    otherBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  });
  
  previewingVoiceName = voice.name;
  btn.classList.add("playing");
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
  
  // Localized preview text
  let text = "This is a preview of my voice in Speechify.";
  if (voice.lang.toLowerCase().startsWith("es")) text = "Esta es una demostración de mi voz en Speechify.";
  else if (voice.lang.toLowerCase().startsWith("fr")) text = "Ceci est un aperçu de ma voix dans Speechify.";
  else if (voice.lang.toLowerCase().startsWith("de")) text = "Dies ist eine Hörprobe meiner Stimme in Speechify.";
  else if (voice.lang.toLowerCase().startsWith("it")) text = "Questo è un'anteprima della mia voce in Speechify.";
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.rate = parseFloat(document.getElementById("panel-speed-slider").value);
  
  utterance.onend = () => {
    previewingVoiceName = null;
    btn.classList.remove("playing");
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  };
  
  utterance.onerror = () => {
    previewingVoiceName = null;
    btn.classList.remove("playing");
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  };
  
  window.speechSynthesis.speak(utterance);
}

// 5. Event Listeners Setup
function setupEventListeners() {
  // Speed Slider
  const slider = document.getElementById("panel-speed-slider");
  const speedVal = document.getElementById("panel-speed-val");
  
  slider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    speedVal.textContent = `${val.toFixed(1)}x`;
    chrome.storage.local.set({ speechRate: val });
  });
  
  // Search Box
  document.getElementById("voice-search").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderVoiceList();
  });
  
  // Language Filters
  document.getElementById("lang-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab-btn");
    if (!tab) return;
    
    document.querySelectorAll(".tab-btn").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    
    currentLanguageFilter = tab.dataset.lang;
    renderVoiceList();
  });
  
  // Dashboard Controls Integration
  document.getElementById("panel-play-pause").addEventListener("click", () => {
    if (currentPlaybackState.isPlaying) {
      sendControlMessage("pause");
    } else {
      sendControlMessage("play");
    }
  });
  
  document.getElementById("panel-skip-back").addEventListener("click", () => {
    sendControlMessage("skip_back");
  });
  
  document.getElementById("panel-skip-fwd").addEventListener("click", () => {
    sendControlMessage("skip_fwd");
  });
  
  document.getElementById("panel-stop").addEventListener("click", () => {
    sendControlMessage("stop");
  });
}

// 6. Messaging and Tab Communication
function sendControlMessage(controlAction) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].id !== undefined) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "sidepanel_control",
        control: controlAction
      }).catch(err => {
        console.warn("Could not send control event to active page:", err);
      });
    }
  });
}

function syncWithActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].id !== undefined) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "sidepanel_status" })
        .then(response => {
          if (response && response.state) {
            updateDashboardUI(response.state);
          }
        })
        .catch(() => {
          // Content script might not be loaded or active selection is empty, which is normal
        });
    }
  });
}

// 7. Receive playback updates from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "state_update" && message.state) {
    updateDashboardUI(message.state);
  }
});

// 8. Update Dashboard Playback UI
function updateDashboardUI(state) {
  currentPlaybackState = state;
  
  // Text display
  const activeTextEl = document.getElementById("active-text");
  if (state.isPlaying || state.isPaused) {
    activeTextEl.textContent = state.currentSentenceText || "Reading Selection...";
  } else {
    activeTextEl.textContent = "Select text on a webpage and right-click \"Read selection with Speechify\" to begin.";
  }
  
  // Progress calculations
  const progressTextEl = document.getElementById("progress-text");
  const progressFillEl = document.getElementById("progress-fill");
  
  if (state.sentencesCount > 0) {
    progressTextEl.textContent = `${state.sentenceIndex + 1} / ${state.sentencesCount} sentences`;
    const percent = ((state.sentenceIndex + 1) / state.sentencesCount) * 100;
    progressFillEl.style.width = `${percent}%`;
  } else {
    progressTextEl.textContent = "0 / 0 sentences";
    progressFillEl.style.width = "0%";
  }
  
  // Play/Pause button state
  const playBtnIcon = document.getElementById("panel-play-icon");
  const playBtn = document.getElementById("panel-play-pause");
  if (state.isPlaying) {
    playBtnIcon.outerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" id="panel-play-icon"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    playBtn.title = "Pause Reading";
    playBtn.classList.add("playing");
  } else {
    playBtnIcon.outerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" id="panel-play-icon"><path d="M8 5v14l11-7z"/></svg>`;
    playBtn.title = "Resume Reading";
    playBtn.classList.remove("playing");
  }
}
