// content.js - Speechify Extension Content Script & Reading Engine

let speechState = {
  selectedText: "",
  selectionRange: null,
  textNodesMap: [],
  sentences: [],
  sentenceIndex: 0,
  isPlaying: false,
  isPaused: false,
  utterance: null,
  currentSentenceRange: null,
  speed: 1.0,
  voiceName: null,
  highlightStyle: "both", // "both", "sentence", "word", "none"
  floatingPlayer: null,
  shadowRoot: null
};

// 1. Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "start_reading") {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      console.warn("Speechify: No selection found.");
      return;
    }
    
    const range = selection.getRangeAt(0);
    const text = range.toString().trim();
    if (!text) {
      console.warn("Speechify: Selection is empty.");
      return;
    }
    
    initializeSpeechFlow(range, text);
    sendResponse({ success: true });
  } else if (message.action === "sidepanel_status") {
    // Reply to side panel with current state for synchronization
    sendStateToSidepanel();
  } else if (message.action === "sidepanel_control") {
    handleSidepanelControl(message.control);
  }
});

// Listen to storage changes to sync settings dynamically
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.activeVoiceName) {
      speechState.voiceName = changes.activeVoiceName.newValue;
      if (speechState.isPlaying) {
        // Restart current sentence with new voice immediately
        restartCurrentSentence();
      }
    }
    if (changes.speechRate) {
      speechState.speed = parseFloat(changes.speechRate.newValue || 1.0);
      if (speechState.isPlaying) {
        // Restart current sentence with new speed immediately
        restartCurrentSentence();
      }
    }
    // Update player UI speed bubble if open
    updatePlayerUI();
  }
});

// Load initial settings
chrome.storage.local.get(["activeVoiceName", "speechRate"], (result) => {
  if (result.activeVoiceName) speechState.voiceName = result.activeVoiceName;
  if (result.speechRate) speechState.speed = parseFloat(result.speechRate);
});

// 2. Setup speech flow
function initializeSpeechFlow(range, text) {
  // Ensure highlight styles are loaded in the page context
  injectHighlightStyles();

  // Stop any active synthesis
  stopSpeech();
  
  speechState.selectionRange = range;
  speechState.selectedText = text;
  
  // Map selection offsets to DOM text nodes
  speechState.textNodesMap = buildTextNodeMap(range);
  
  // Segment text into sentences
  speechState.sentences = splitIntoSentences(text);
  speechState.sentenceIndex = 0;
  
  if (speechState.sentences.length === 0) return;
  
  // Inject or show floating player
  showFloatingPlayer();
  
  // Start speaking
  playSentence(0);
}

function injectHighlightStyles() {
  const styleId = "speechify-highlight-styles";
  if (document.getElementById(styleId)) return;
  
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    ::highlight(speechify-sentence) {
      background-color: rgba(79, 134, 247, 0.22) !important;
      color: inherit !important;
    }
    ::highlight(speechify-word) {
      background-color: rgba(255, 215, 0, 0.75) !important;
      color: #000000 !important;
    }
  `;
  document.documentElement.appendChild(style);
}

// 3. Flat Selection Offset to DOM Ranges Mapping
function buildTextNodeMap(range) {
  const map = [];
  let currentSelectionOffset = 0;
  const container = range.commonAncestorContainer;

  if (container.nodeType === Node.TEXT_NODE) {
    const start = range.startOffset;
    const end = range.endOffset;
    map.push({
      node: container,
      startOffset: start,
      endOffset: end,
      selStart: 0,
      selEnd: end - start
    });
    return map;
  }

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(node);
        
        // Reject if nodeRange starts after range ends, OR ends before range starts
        if (range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0 ||
            range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    let nodeStart = 0;
    let nodeEnd = node.nodeValue.length;

    if (node === range.startContainer) {
      nodeStart = range.startOffset;
    }
    if (node === range.endContainer) {
      nodeEnd = range.endOffset;
    }

    const length = nodeEnd - nodeStart;
    if (length > 0) {
      map.push({
        node: node,
        startOffset: nodeStart,
        endOffset: nodeEnd,
        selStart: currentSelectionOffset,
        selEnd: currentSelectionOffset + length
      });
      currentSelectionOffset += length;
    }
  }
  return map;
}

function createDOMRangesForOffset(map, start, end) {
  const ranges = [];
  for (const entry of map) {
    const overlapStart = Math.max(start, entry.selStart);
    const overlapEnd = Math.min(end, entry.selEnd);
    
    if (overlapStart < overlapEnd) {
      const range = document.createRange();
      const nodeStartOffset = entry.startOffset + (overlapStart - entry.selStart);
      const nodeEndOffset = entry.startOffset + (overlapEnd - entry.selStart);
      
      range.setStart(entry.node, nodeStartOffset);
      range.setEnd(entry.node, nodeEndOffset);
      ranges.push(range);
    }
  }
  return ranges;
}

// 4. NLP Sentence Splitter
function splitIntoSentences(text) {
  const sentences = [];
  // Sentence boundary: split by . ! ? or newlines followed by whitespace/EOF
  const regex = /[^.!?\r\n]+([.!?\r\n]+|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawText = match[0];
    const trimmedText = rawText.trim();
    if (trimmedText.length > 0) {
      const start = match.index + rawText.indexOf(trimmedText);
      const end = start + trimmedText.length;
      sentences.push({
        text: trimmedText,
        startOffset: start,
        endOffset: end
      });
    }
  }
  return sentences;
}

// 5. Speech Playback Core
function playSentence(index) {
  if (index < 0 || index >= speechState.sentences.length) {
    // Reached the end of the text selection. Reset index, clear highlight but keep player visible!
    speechState.sentenceIndex = 0;
    speechState.isPlaying = false;
    speechState.isPaused = false;
    updateHighlights(null, []);
    updatePlayerUI();
    sendStateToSidepanel();
    return;
  }
  
  speechState.sentenceIndex = index;
  speechState.isPlaying = true;
  speechState.isPaused = false;
  
  const sentence = speechState.sentences[index];
  
  // Highlight sentence range
  speechState.currentSentenceRange = createDOMRangesForOffset(
    speechState.textNodesMap, 
    sentence.startOffset, 
    sentence.endOffset
  );
  updateHighlights(speechState.currentSentenceRange, []);
  
  // Build utterance
  speechState.utterance = new SpeechSynthesisUtterance(sentence.text);
  speechState.utterance.rate = speechState.speed;
  
  // Load selected voice
  const voices = window.speechSynthesis.getVoices();
  let selectedVoice = null;
  
  if (speechState.voiceName) {
    selectedVoice = voices.find(v => v.name === speechState.voiceName);
  }
  if (!selectedVoice) {
    // Fallback: Pick a standard Google/Microsoft English voice or default browser voice
    selectedVoice = voices.find(v => v.lang.startsWith("en-") && v.name.includes("Google")) ||
                    voices.find(v => v.lang.startsWith("en-")) ||
                    voices[0];
  }
  
  if (selectedVoice) {
    speechState.utterance.voice = selectedVoice;
  }
  
  // Boundary event (word-by-word highlighting)
  speechState.utterance.onboundary = (event) => {
    if (event.name === "word") {
      const sentenceOffset = event.charIndex;
      // Get word length
      let wordLength = event.charLength;
      if (!wordLength || wordLength === 0) {
        const textFromChar = sentence.text.substring(sentenceOffset);
        const match = textFromChar.match(/^[a-zA-Z0-9']+/);
        wordLength = match ? match[0].length : 1;
      }
      
      const wordStart = sentence.startOffset + sentenceOffset;
      const wordEnd = wordStart + wordLength;
      
      const wordRanges = createDOMRangesForOffset(speechState.textNodesMap, wordStart, wordEnd);
      updateHighlights(speechState.currentSentenceRange, wordRanges);
    }
  };
  
  speechState.utterance.onend = () => {
    playSentence(index + 1);
  };
  
  speechState.utterance.onerror = (e) => {
    console.error("SpeechSynthesisUtterance error:", e);
    if (e.error !== "interrupted") {
      playSentence(index + 1);
    }
  };
  
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(speechState.utterance);
  updatePlayerUI();
  sendStateToSidepanel();
}

function pauseSpeech() {
  if (speechState.isPlaying && !speechState.isPaused) {
    window.speechSynthesis.pause();
    speechState.isPaused = true;
    speechState.isPlaying = false;
    updatePlayerUI();
    sendStateToSidepanel();
  }
}

function resumeSpeech() {
  if (speechState.isPaused) {
    window.speechSynthesis.resume();
    speechState.isPlaying = true;
    speechState.isPaused = false;
    // Fallback for Chrome bug: if speaking is false after resume, restart sentence
    setTimeout(() => {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending && speechState.isPlaying) {
        playSentence(speechState.sentenceIndex);
      }
    }, 150);
    updatePlayerUI();
    sendStateToSidepanel();
  }
}

function stopSpeech() {
  window.speechSynthesis.cancel();
  speechState.isPlaying = false;
  speechState.isPaused = false;
  speechState.sentences = [];
  speechState.sentenceIndex = 0;
  speechState.currentSentenceRange = null;
  updateHighlights(null, []);
  hideFloatingPlayer();
  sendStateToSidepanel();
}

function restartCurrentSentence() {
  if (speechState.sentences.length > 0) {
    playSentence(speechState.sentenceIndex);
  }
}

// 6. Highlights Rendering
function updateHighlights(sentenceRanges, wordRanges) {
  if (!("highlights" in CSS)) return;
  
  if (sentenceRanges && sentenceRanges.length > 0 && speechState.highlightStyle !== "none" && speechState.highlightStyle !== "word") {
    const sHighlight = new Highlight(...sentenceRanges);
    CSS.highlights.set("speechify-sentence", sHighlight);
  } else {
    CSS.highlights.delete("speechify-sentence");
  }
  
  if (wordRanges && wordRanges.length > 0 && speechState.highlightStyle !== "none" && speechState.highlightStyle !== "sentence") {
    const wHighlight = new Highlight(...wordRanges);
    CSS.highlights.set("speechify-word", wHighlight);
  } else {
    CSS.highlights.delete("speechify-word");
  }
}

// 7. Inject Shadow DOM Floating Player
function showFloatingPlayer() {
  if (speechState.floatingPlayer) {
    updatePlayerUI();
    speechState.floatingPlayer.style.display = "block";
    return;
  }
  
  const host = document.createElement("div");
  host.id = "speechify-player-host";
  host.style.position = "fixed";
  host.style.top = "15%";
  host.style.right = "24px";
  host.style.zIndex = "2147483647";
  document.body.appendChild(host);
  
  const shadow = host.attachShadow({ mode: "open" });
  speechState.floatingPlayer = host;
  speechState.shadowRoot = shadow;
  
  // Inline styles for glassmorphism vertical player bar (compact)
  const style = document.createElement("style");
  style.textContent = `
    .player-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: rgba(20, 20, 28, 0.85);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 8px 5px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45), 0 0 1px rgba(255, 255, 255, 0.15);
      user-select: none;
      width: 38px;
      gap: 6px;
      font-family: system-ui, -apple-system, sans-serif;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .drag-handle {
      width: 18px;
      height: 8px;
      cursor: move;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      padding: 2px 0 4px 0;
      opacity: 0.4;
      transition: opacity 0.2s;
    }
    .drag-handle:hover {
      opacity: 0.8;
    }
    .drag-line {
      width: 12px;
      height: 1.5px;
      background: white;
      border-radius: 1px;
    }
    
    .btn {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: rgba(255, 255, 255, 0.8);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
    }
    .btn svg {
      width: 12px !important;
      height: 12px !important;
    }
    .btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: white;
      transform: scale(1.08);
    }
    .btn:active {
      transform: scale(0.95);
    }
    
    .btn-primary {
      background: linear-gradient(135deg, #7B2CBF, #3A86C8);
      color: white;
      box-shadow: 0 3px 8px rgba(123, 44, 191, 0.3);
      width: 28px;
      height: 28px;
    }
    .btn-primary svg {
      width: 13px !important;
      height: 13px !important;
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #9D4EDD, #4ea8de);
      box-shadow: 0 5px 12px rgba(123, 44, 191, 0.5);
    }
    
    .btn-close {
      color: rgba(239, 68, 68, 0.7);
      margin-top: 2px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0;
      padding-top: 8px;
      width: 18px;
      height: 22px;
      border-left: none;
      padding-left: 0;
      margin-left: 0;
    }
    .btn-close:hover {
      background: transparent;
      color: rgba(239, 68, 68, 1);
    }
    
    .speed-badge {
      font-size: 9px;
      font-weight: 600;
      color: #3A86C8;
      background: rgba(58, 134, 200, 0.12);
      padding: 1px 3px;
      border-radius: 4px;
      pointer-events: none;
    }
    
    /* Tooltip container */
    .tooltip-container {
      position: relative;
    }
    .tooltip {
      visibility: hidden;
      background-color: #121214;
      color: #fff;
      text-align: center;
      padding: 3px 6px;
      border-radius: 4px;
      position: absolute;
      right: 34px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 10px;
      white-space: nowrap;
      z-index: 10;
      opacity: 0;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: opacity 0.2s, visibility 0.2s;
    }
    .tooltip-container:hover .tooltip {
      visibility: visible;
      opacity: 1;
    }
    
    /* Indicator dot */
    .indicator {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 6px #ef4444;
      transition: all 0.3s;
      margin-top: 2px;
      margin-left: 0;
    }
    .indicator.playing {
      background: #10b981;
      box-shadow: 0 0 6px #10b981;
    }
    .indicator.paused {
      background: #f59e0b;
      box-shadow: 0 0 6px #f59e0b;
    }
    
    /* Speed popover slider */
    .speed-panel {
      position: absolute;
      right: 42px;
      bottom: 8px;
      background: rgba(20, 20, 28, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 8px 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      display: none;
      flex-direction: column;
      gap: 4px;
      width: 130px;
      backdrop-filter: blur(10px);
    }
    .speed-panel.show {
      display: flex;
    }
    .speed-panel-title {
      font-size: 9px;
      color: rgba(255,255,255,0.5);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .speed-slider {
      width: 100%;
      accent-color: #3A86C8;
      cursor: pointer;
    }
    .speed-value-display {
      font-size: 10px;
      color: white;
      text-align: right;
      font-weight: bold;
    }
  `;
  shadow.appendChild(style);
  
  const container = document.createElement("div");
  container.className = "player-container";
  container.innerHTML = `
    <div class="drag-handle" title="Drag to re-position">
      <div class="drag-line"></div>
      <div class="drag-line"></div>
    </div>
    
    <div class="tooltip-container">
      <button class="btn btn-primary" id="play-pause-btn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <span class="tooltip">Play Selection</span>
    </div>
    
    <div class="tooltip-container">
      <button class="btn" id="skip-back-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
      </button>
      <span class="tooltip">Previous Sentence</span>
    </div>
    
    <div class="tooltip-container">
      <button class="btn" id="skip-fwd-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6zm9-12h2v12h-2z"/></svg>
      </button>
      <span class="tooltip">Next Sentence</span>
    </div>
    
    <div class="tooltip-container">
      <button class="btn" id="voice-settings-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" x2="12" y1="19" y2="22"></line>
        </svg>
      </button>
      <span class="tooltip">Voice Studio (Sidebar)</span>
    </div>
    
    <div class="tooltip-container">
      <button class="btn" id="speed-settings-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      </button>
      <span class="tooltip">Adjust Speed</span>
    </div>
    
    <span class="speed-badge" id="speed-indicator">1.0x</span>
    
    <button class="btn btn-close" id="close-btn" title="Stop & Dismiss">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
    
    <div class="indicator" id="playback-indicator"></div>
    
    <div class="speed-panel" id="speed-panel">
      <div class="speed-panel-title">Speed Rate</div>
      <input type="range" class="speed-slider" id="speed-slider" min="0.5" max="3.0" step="0.1" value="1.0">
      <div class="speed-value-display" id="speed-val">1.0x</div>
    </div>
  `;
  shadow.appendChild(container);
  
  // Attach Event Listeners
  setupDraggable(host, shadow.querySelector(".drag-handle"));
  
  shadow.querySelector("#play-pause-btn").addEventListener("click", () => {
    if (speechState.isPlaying) {
      pauseSpeech();
    } else if (speechState.isPaused) {
      resumeSpeech();
    } else {
      restartCurrentSentence();
    }
  });
  
  shadow.querySelector("#skip-back-btn").addEventListener("click", () => {
    playSentence(speechState.sentenceIndex - 1);
  });
  
  shadow.querySelector("#skip-fwd-btn").addEventListener("click", () => {
    playSentence(speechState.sentenceIndex + 1);
  });
  
  shadow.querySelector("#voice-settings-btn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "open_side_panel" }, (response) => {
      if (response && response.error) {
        console.warn("Failed to open sidebar via gesture, falling back to storage listener", response.error);
      }
    });
  });
  
  const speedBtn = shadow.querySelector("#speed-settings-btn");
  const speedPanel = shadow.querySelector("#speed-panel");
  const speedSlider = shadow.querySelector("#speed-slider");
  const speedVal = shadow.querySelector("#speed-val");
  
  speedBtn.addEventListener("click", (e) => {
    speedPanel.classList.toggle("show");
    e.stopPropagation();
  });
  
  document.addEventListener("click", () => {
    speedPanel.classList.remove("show");
  });
  speedPanel.addEventListener("click", (e) => e.stopPropagation());
  
  speedSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    speedVal.textContent = `${val.toFixed(1)}x`;
    chrome.storage.local.set({ speechRate: val });
  });
  
  shadow.querySelector("#close-btn").addEventListener("click", () => {
    stopSpeech();
  });
  
  updatePlayerUI();
}

function updatePlayerUI() {
  if (!speechState.shadowRoot) return;
  
  const shadow = speechState.shadowRoot;
  
  const playBtn = shadow.querySelector("#play-pause-btn");
  const tooltipText = playBtn.nextElementSibling;
  
  if (speechState.isPlaying) {
    playBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    tooltipText.textContent = "Pause Speech";
  } else {
    playBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    tooltipText.textContent = "Play Speech";
  }
  
  const indicator = shadow.querySelector("#playback-indicator");
  indicator.className = "indicator";
  if (speechState.isPlaying) {
    indicator.classList.add("playing");
  } else if (speechState.isPaused) {
    indicator.classList.add("paused");
  }
  
  shadow.querySelector("#speed-indicator").textContent = `${speechState.speed.toFixed(1)}x`;
  shadow.querySelector("#speed-slider").value = speechState.speed;
  shadow.querySelector("#speed-val").textContent = `${speechState.speed.toFixed(1)}x`;
}

function hideFloatingPlayer() {
  if (speechState.floatingPlayer) {
    speechState.floatingPlayer.style.display = "none";
  }
}

// 8. Player Dragging Implementation
function setupDraggable(playerElement, dragHandle) {
  let isDragging = false;
  let startX, startY;
  let initialX, initialY;

  dragHandle.addEventListener("mousedown", dragStart);

  function dragStart(e) {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    const rect = playerElement.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    
    document.addEventListener("mousemove", dragMove);
    document.addEventListener("mouseup", dragEnd);
    document.body.classList.add("speechify-no-select");
    e.preventDefault();
  }

  function dragMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    let newX = initialX + dx;
    let newY = initialY + dy;
    
    // Dynamic bounds check based on element dimensions
    newX = Math.max(0, Math.min(window.innerWidth - playerElement.offsetWidth, newX));
    newY = Math.max(0, Math.min(window.innerHeight - playerElement.offsetHeight, newY));
    
    playerElement.style.left = `${newX}px`;
    playerElement.style.top = `${newY}px`;
    playerElement.style.right = "auto";
    playerElement.style.bottom = "auto";
  }

  function dragEnd() {
    isDragging = false;
    document.removeEventListener("mousemove", dragMove);
    document.removeEventListener("mouseup", dragEnd);
    document.body.classList.remove("speechify-no-select");
  }
}

// 9. State synchronization with Sidepanel Dashboard
function sendStateToSidepanel() {
  const currentSentenceText = speechState.sentences[speechState.sentenceIndex]?.text || "";
  chrome.runtime.sendMessage({
    action: "state_update",
    state: {
      isPlaying: speechState.isPlaying,
      isPaused: speechState.isPaused,
      sentencesCount: speechState.sentences.length,
      sentenceIndex: speechState.sentenceIndex,
      currentSentenceText: currentSentenceText,
      selectedText: speechState.selectedText,
      speed: speechState.speed
    }
  }).catch(() => {
    // Ignore error if side panel is not open/listening
  });
}

function handleSidepanelControl(control) {
  switch (control) {
    case "play":
      if (speechState.isPaused) resumeSpeech();
      else restartCurrentSentence();
      break;
    case "pause":
      pauseSpeech();
      break;
    case "stop":
      // Reset playback progress but keep the player visible on the page
      window.speechSynthesis.cancel();
      speechState.isPlaying = false;
      speechState.isPaused = false;
      speechState.sentenceIndex = 0;
      updateHighlights(null, []);
      updatePlayerUI();
      sendStateToSidepanel();
      break;
    case "skip_fwd":
      playSentence(speechState.sentenceIndex + 1);
      break;
    case "skip_back":
      playSentence(speechState.sentenceIndex - 1);
      break;
  }
}
