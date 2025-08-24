const DEFAULTS = {
  enabled: true,
  threshold: 60,
  dimInsteadOfHide: false,
  requireSubFlair: false,
  minTitleChars: 25,
  myUsername: ""
};

const els = {
  enabled: document.getElementById("enabled"),
  threshold: document.getElementById("threshold"),
  thresholdVal: document.getElementById("thresholdVal"),
  requireSubFlair: document.getElementById("requireSubFlair"),
  dimInsteadOfHide: document.getElementById("dimInsteadOfHide"),
  minTitleChars: document.getElementById("minTitleChars"),
  myUsername: document.getElementById("myUsername"),
  detectedUser: document.getElementById("detectedUser")
};

function save(changes) {
  chrome.storage.sync.set(changes);
}

// Load settings
chrome.storage.sync.get(DEFAULTS, (v) => {
  els.enabled.checked = v.enabled;
  els.threshold.value = v.threshold;
  els.thresholdVal.textContent = v.threshold;
  els.requireSubFlair.checked = v.requireSubFlair;
  els.dimInsteadOfHide.checked = v.dimInsteadOfHide;
  els.minTitleChars.value = v.minTitleChars;
  els.myUsername.value = v.myUsername || "";
});

// Also try to populate detected user from local storage on open
chrome.storage.local.get({ aiqCurrentUser: null }, (v) => {
  if (v && v.aiqCurrentUser) {
    els.detectedUser.textContent = `Detected user: ${v.aiqCurrentUser}`;
  }
});

// Event listeners
els.enabled.addEventListener("change", () => save({ enabled: els.enabled.checked }));
els.requireSubFlair.addEventListener("change", () => save({ requireSubFlair: els.requireSubFlair.checked }));
els.dimInsteadOfHide.addEventListener("change", () => save({ dimInsteadOfHide: els.dimInsteadOfHide.checked }));
els.threshold.addEventListener("input", () => {
  els.thresholdVal.textContent = els.threshold.value;
});
els.threshold.addEventListener("change", () => save({ threshold: parseInt(els.threshold.value, 10) }));
els.minTitleChars.addEventListener("change", () => save({ minTitleChars: parseInt(els.minTitleChars.value, 10) }));
els.myUsername.addEventListener("change", () => save({ myUsername: els.myUsername.value.trim() }));

// Listen for auto-detected username from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "aiq-current-user") {
    els.detectedUser.textContent = `Detected user: ${msg.user || "(unknown)"}`;
  }
});
