const form = document.querySelector("#link-form");
const urlInput = document.querySelector("#medal-url");
const pasteButton = document.querySelector("#paste-button");
const loadButton = document.querySelector("#load-button");
const fileInput = document.querySelector("#video-file");
const dropZone = document.querySelector("#drop-zone");
const mainColumn = document.querySelector(".main-column");
const statusLine = document.querySelector("#status-line");
const clipOverview = document.querySelector("#clip-overview");
const overviewGrid = document.querySelector("#overview-grid");
const overviewCount = document.querySelector("#overview-count");
const clearBatchButton = document.querySelector("#clear-batch");
const batchPlayButton = document.querySelector("#batch-play");
const batchPauseButton = document.querySelector("#batch-pause");
const batchSeek = document.querySelector("#batch-seek");
const batchClock = document.querySelector("#batch-clock");
const batchDuration = document.querySelector("#batch-duration");
const playbackSpeed = document.querySelector("#playback-speed");
const reviewTab = document.querySelector("#tab-review");
const installTab = document.querySelector("#tab-install");
const reviewPanel = document.querySelector("#review-panel");
const installPanel = document.querySelector("#install-panel");
const installButton = document.querySelector("#install-button");
const installStatus = document.querySelector("#install-status");
const installHelp = document.querySelector(".install-help");
const clipItems = [];
let nextClipId = 1;
let batchSyncTimer = null;
let focusedClipId = null;
let deferredInstallPrompt = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
    .catch((error) => console.error("Could not register the Kira Clip Desk app shell.", error));
}

function selectWorkspaceTab(tab) {
  const showReview = tab === reviewTab;
  reviewTab.setAttribute("aria-selected", String(showReview));
  reviewTab.tabIndex = showReview ? 0 : -1;
  reviewPanel.hidden = !showReview;
  installTab.setAttribute("aria-selected", String(!showReview));
  installTab.tabIndex = showReview ? -1 : 0;
  installPanel.hidden = showReview;
}

for (const tab of [reviewTab, installTab]) {
  tab.addEventListener("click", () => selectWorkspaceTab(tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextTab = tab === reviewTab ? installTab : reviewTab;
    selectWorkspaceTab(nextTab);
    nextTab.focus();
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installStatus.textContent = "Kira is ready to install on this device.";
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButton.disabled = true;
  installButton.textContent = "KIRA CLIP DESK INSTALLED";
  installStatus.textContent = "Kira is installed and ready in its own window.";
});

if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) {
  installButton.disabled = true;
  installButton.textContent = "KIRA CLIP DESK INSTALLED";
  installStatus.textContent = "Kira is already open as an installed app.";
}

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    installStatus.textContent = "Your browser does not offer the install prompt here. Use the steps below to add Kira.";
    installHelp.open = true;
    return;
  }

  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    installStatus.textContent = choice.outcome === "accepted"
      ? "Kira is installing. Find it in your desktop or app menu."
      : "No problem. Kira will stay available in your browser.";
  } catch (error) {
    console.error("Could not open the Kira Clip Desk install prompt.", error);
    installStatus.textContent = "The install prompt could not open. Use the browser menu steps below.";
    installHelp.open = true;
  }
});

function setStatus(message, kind = "") {
  statusLine.textContent = message;
  statusLine.dataset.kind = kind;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "Length unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function getPreviewVideos() {
  return Array.from(overviewGrid.querySelectorAll(".overview-media video"));
}

function updateBatchControls() {
  const videos = getPreviewVideos();
  const knownDurations = clipItems
    .filter((item) => Number.isFinite(item.duration))
    .map((item) => item.duration);
  const loadedDurations = videos
    .map((video) => video.duration)
    .filter(Number.isFinite);
  const duration = Math.max(0, ...knownDurations, ...loadedDurations);
  batchPlayButton.disabled = videos.length === 0 || videos.some((video) => video.readyState < 1);
  batchPauseButton.disabled = videos.length === 0;
  batchSeek.disabled = videos.length === 0 || duration === 0;
  batchSeek.max = String(Math.round(duration * 10));
  batchDuration.textContent = duration ? formatDuration(duration) : "--:--";
  updateBatchClock();
}

function updateBatchClock() {
  const reference = getFocusedVideo() || getPreviewVideos()[0];
  if (!reference || !Number.isFinite(reference.currentTime)) {
    batchClock.textContent = "00:00";
    batchSeek.value = "0";
    return;
  }
  batchClock.textContent = formatDuration(reference.currentTime);
  batchSeek.value = String(Math.round(reference.currentTime * 10));
}

function getFocusedVideo(videos = getPreviewVideos()) {
  return videos.find((video) => video.closest(".overview-card")?.dataset.clipId === focusedClipId) || null;
}

function getBatchReferenceVideo(videos = getPreviewVideos()) {
  const focusedVideo = getFocusedVideo(videos);
  return focusedVideo || videos.find((video) => !video.paused && !video.ended) || videos[0] || null;
}

function seekBatchTo(time) {
  for (const video of getPreviewVideos()) {
    if (Number.isFinite(video.duration)) {
      video.currentTime = Math.max(0, Math.min(time, video.duration));
    }
  }
  updateBatchClock();
}

async function playBatch() {
  const videos = getPreviewVideos();
  const reference = getBatchReferenceVideo(videos);
  if (!reference) return;
  const startTime = reference.currentTime || 0;
  const speed = Number(playbackSpeed.value);
  await Promise.all(videos.map(async (video) => {
    if (Number.isFinite(video.duration)) video.currentTime = Math.min(startTime, video.duration);
    video.playbackRate = speed;
    try {
      await video.play();
    } catch {
      setStatus("A preview could not start. Use its individual play control.", "error");
    }
  }));
  startBatchSync();
}

async function toggleFocusedPlayback() {
  const video = getFocusedVideo();
  if (!video) return;
  stopBatchSync();
  if (!video.paused && !video.ended) {
    video.pause();
    return;
  }
  try {
    await video.play();
  } catch {
    setStatus("This clip could not start. Use its on-player controls to try again.", "error");
  }
}

function pauseBatch() {
  for (const video of getPreviewVideos()) video.pause();
  stopBatchSync();
}

function moveFocusedClip(direction, target) {
  const readyItems = clipItems.filter((item) => item.status === "ready");
  if (!readyItems.length) return;
  const activeItem = target instanceof Element
    ? target.closest(".overview-card")?.dataset.clipId
    : null;
  const playingItem = getBatchReferenceVideo()?.closest(".overview-card")?.dataset.clipId;
  const currentIndex = [activeItem, focusedClipId, playingItem]
    .filter(Boolean)
    .map((id) => readyItems.findIndex((item) => item.id === id))
    .find((index) => index >= 0) ?? 0;
  const nextIndex = Math.max(0, Math.min(readyItems.length - 1, currentIndex + direction));
  focusedClipId = readyItems[nextIndex].id;
  syncFocusView();
  overviewGrid.focus({ preventScroll: true });
  const nextCard = Array.from(overviewGrid.querySelectorAll(".overview-card"))
    .find((card) => card.dataset.clipId === focusedClipId);
  nextCard?.scrollIntoView({
    block: "nearest",
    behavior: "smooth",
  });
}

function isTypingOrUsingControl(target, key) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, a, video, [contenteditable='true'], [role='slider']")) return true;
  const button = target.closest("button");
  if (!button) return false;
  return !(["ArrowUp", "ArrowDown"].includes(key) && button.matches(".overview-focus"));
}

function clearQueue() {
  stopBatchSync();
  for (const video of getPreviewVideos()) video.pause();
  for (const item of clipItems) {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  }
  clipItems.length = 0;
  focusedClipId = null;
  renderOverview();
}

function renderOverview() {
  const total = clipItems.length;
  const ready = clipItems.filter((item) => item.status === "ready").length;
  document.body.classList.toggle("batch-active", total > 0);
  clipOverview.hidden = total === 0;
  dropZone.hidden = total > 0;
  updateOverviewCount(ready, total);
  overviewGrid.replaceChildren();
  if (!clipItems.some((item) => item.id === focusedClipId && item.status === "ready")) {
    focusedClipId = clipItems.find((item) => item.status === "ready")?.id || null;
  }

  clipItems.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "overview-card";
    card.dataset.clipId = item.id;
    card.setAttribute("aria-current", String(item.id === focusedClipId));

    const media = document.createElement("div");
    media.className = "overview-media";
    if (item.status === "ready") {
      const preview = document.createElement("video");
      preview.src = item.videoUrl;
      preview.controls = true;
      preview.muted = item.id !== focusedClipId;
      preview.playsInline = true;
      preview.preload = "metadata";
      preview.setAttribute("aria-label", `Preview ${item.title}`);
      preview.addEventListener("pointerdown", () => {
        focusedClipId = item.id;
        stopBatchSync();
        syncFocusView();
      });
      preview.addEventListener("loadedmetadata", () => {
        item.duration = preview.duration;
        updateBatchControls();
        if (preview.currentTime === 0 && preview.duration > 0.1) {
          preview.currentTime = 0.1;
        }
      });
      preview.addEventListener("durationchange", updateBatchControls);
      preview.addEventListener("timeupdate", updateBatchClock);
      media.append(preview);
    } else {
      const unavailable = document.createElement("span");
      unavailable.className = "overview-unavailable";
      unavailable.textContent = item.status === "error" ? "CLIP UNAVAILABLE" : item.status.toUpperCase();
      media.append(unavailable);
    }

    const footer = document.createElement("div");
    footer.className = "overview-card-footer";
    const identity = document.createElement("div");
    identity.className = "overview-identity";
    const number = document.createElement("span");
    number.className = "overview-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const details = document.createElement("div");
    details.className = "overview-details";
    const title = document.createElement("p");
    title.className = "overview-title";
    title.textContent = item.title;
    const metadata = document.createElement("p");
    metadata.className = "overview-metadata";
    metadata.textContent = item.status === "ready"
      ? [item.uploader || item.sourceLabel, Number.isFinite(item.duration) ? formatDuration(item.duration) : ""].filter(Boolean).join(" / ")
      : item.error || item.sourceLabel;
    details.append(title, metadata);
    identity.append(number, details);

    const focusButton = document.createElement("button");
    focusButton.type = "button";
    focusButton.className = "overview-focus";
    focusButton.disabled = item.status !== "ready";
    focusButton.textContent = item.id === focusedClipId ? "IN FOCUS" : "FOCUS";
    focusButton.setAttribute("aria-pressed", String(item.id === focusedClipId));
    focusButton.addEventListener("click", () => {
      focusedClipId = item.id;
      syncFocusView();
      overviewGrid.focus({ preventScroll: true });
    });
    const actions = document.createElement("div");
    actions.className = "overview-card-actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", `Actions for ${item.title}`);

    const moveUpButton = document.createElement("button");
    moveUpButton.type = "button";
    moveUpButton.className = "overview-move";
    moveUpButton.textContent = "↑";
    moveUpButton.title = "Move clip up";
    moveUpButton.setAttribute("aria-label", `Move ${item.title} up`);
    moveUpButton.disabled = index === 0;
    moveUpButton.addEventListener("click", () => moveClip(item.id, -1, moveUpButton));

    const moveDownButton = document.createElement("button");
    moveDownButton.type = "button";
    moveDownButton.className = "overview-move";
    moveDownButton.textContent = "↓";
    moveDownButton.title = "Move clip down";
    moveDownButton.setAttribute("aria-label", `Move ${item.title} down`);
    moveDownButton.disabled = index === clipItems.length - 1;
    moveDownButton.addEventListener("click", () => moveClip(item.id, 1, moveDownButton));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "overview-remove";
    removeButton.textContent = "×";
    removeButton.title = "Remove clip from review";
    removeButton.setAttribute("aria-label", `Remove ${item.title} from review`);
    removeButton.addEventListener("click", () => removeClip(item.id));

    actions.append(moveUpButton, moveDownButton, removeButton, focusButton);
    footer.append(identity, actions);
    card.append(media, footer);
    overviewGrid.append(card);
  });
  syncFocusView();
  updateBatchControls();
}

function updateClipPositions() {
  const cards = Array.from(overviewGrid.querySelectorAll(".overview-card"));
  cards.forEach((card, index) => {
    card.querySelector(".overview-number").textContent = String(index + 1).padStart(2, "0");
    card.querySelector(".overview-move[title='Move clip up']").disabled = index === 0;
    card.querySelector(".overview-move[title='Move clip down']").disabled = index === cards.length - 1;
  });
}

function moveClip(clipId, direction, button) {
  const currentIndex = clipItems.findIndex((item) => item.id === clipId);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= clipItems.length) return;

  const [item] = clipItems.splice(currentIndex, 1);
  clipItems.splice(nextIndex, 0, item);

  const card = overviewGrid.querySelector(`[data-clip-id="${CSS.escape(clipId)}"]`);
  const neighbor = card?.nextElementSibling;
  if (direction < 0) {
    overviewGrid.insertBefore(card, card.previousElementSibling);
  } else if (neighbor) {
    overviewGrid.insertBefore(neighbor, card);
  } else {
    overviewGrid.append(card);
  }
  updateClipPositions();
  button.focus({ preventScroll: true });
  setStatus(`Moved ${item.title} ${direction < 0 ? "up" : "down"} in the review queue.`);
}

function removeClip(clipId) {
  const index = clipItems.findIndex((item) => item.id === clipId);
  if (index < 0) return;
  const [item] = clipItems.splice(index, 1);
  const video = overviewGrid.querySelector(`[data-clip-id="${CSS.escape(clipId)}"] video`);
  video?.pause();
  if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);

  if (focusedClipId === clipId) {
    focusedClipId = clipItems.slice(index).find((candidate) => candidate.status === "ready")?.id
      || clipItems.slice(0, index).reverse().find((candidate) => candidate.status === "ready")?.id
      || null;
  }

  if (!clipItems.length) {
    renderOverview();
    urlInput.focus();
    setStatus("Clip removed. Add more clips to continue reviewing.");
    return;
  }

  overviewGrid.querySelector(`[data-clip-id="${CSS.escape(clipId)}"]`)?.remove();
  syncFocusView();
  updateClipPositions();
  updateOverviewCount();
  updateBatchControls();
  if (!getPreviewVideos().some((preview) => !preview.paused && !preview.ended)) {
    stopBatchSync();
  }
  overviewGrid.querySelector(`[data-clip-id="${CSS.escape(focusedClipId || "")}"] .overview-focus`)?.focus({ preventScroll: true });
  setStatus(`Removed ${item.title} from the review queue.`);
}

function updateOverviewCount(ready = clipItems.filter((item) => item.status === "ready").length, total = clipItems.length) {
  overviewCount.textContent = total === 1
    ? `${ready} of 1 clip ready`
    : `${ready} of ${total} clips ready`;
}

function syncFocusView() {
  const cards = Array.from(overviewGrid.querySelectorAll(".overview-card"));
  for (const card of cards) {
    const isFocused = card.dataset.clipId === focusedClipId;
    card.setAttribute("aria-current", String(isFocused));
    const button = card.querySelector(".overview-focus");
    button.textContent = isFocused ? "IN FOCUS" : "FOCUS";
    button.setAttribute("aria-pressed", String(isFocused));
    const video = card.querySelector("video");
    if (video) video.muted = !isFocused;
  }
  if (playbackSpeed) {
    playbackSpeed.value = String(getFocusedVideo()?.playbackRate || 1);
  }
}

function setBusy(isBusy) {
  loadButton.disabled = isBusy;
  pasteButton.disabled = isBusy;
  fileInput.disabled = isBusy;
}

async function resolveClip(item) {
  item.status = "resolving";
  try {
    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: item.url }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The clip could not be loaded.");
    item.videoUrl = result.video_url;
    item.title = result.title || item.title;
    item.uploader = result.uploader;
    item.duration = result.duration;
    item.status = "ready";
    item.sourceLabel = "MEDAL CLIP";
  } catch (error) {
    item.status = "error";
    item.error = error.message || "Could not load clip.";
  }
}

async function loadMedalLinks(urls) {
  const queuedItems = [];
  for (const url of urls) {
    const item = {
      id: `clip-${nextClipId++}`,
      url,
      title: url,
      sourceLabel: "MEDAL CLIP",
      status: "queued",
    };
    queuedItems.push(item);
    clipItems.push(item);
  }
  renderOverview();
  setBusy(true);
  setStatus(`Adding ${urls.length} Medal ${urls.length === 1 ? "clip" : "clips"} to this review.`);

  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < queuedItems.length) {
      const item = queuedItems[nextIndex++];
      await resolveClip(item);
    }
  };
  const workers = Array.from({ length: Math.min(6, urls.length) }, worker);
  await Promise.all(workers);
  setBusy(false);

  const loaded = queuedItems.filter((item) => item.status === "ready").length;
  const failed = queuedItems.length - loaded;
  renderOverview();
  setStatus(
    `${loaded} of ${queuedItems.length} new ${queuedItems.length === 1 ? "clip" : "clips"} ready.${failed ? ` ${failed} could not be loaded and are marked in the queue.` : " Your new clips are added to this review session."}`,
    failed ? "error" : "",
  );
}

function addLocalFiles(files) {
  if (loadButton.disabled) {
    setStatus("Wait for the current batch to finish before adding another.", "error");
    return;
  }
  const videos = Array.from(files).filter((file) => file.type.startsWith("video/"));
  if (!videos.length) {
    setStatus("Choose one or more supported video files.", "error");
    return;
  }

  for (const file of videos) {
    const objectUrl = URL.createObjectURL(file);
    clipItems.push({
      id: `clip-${nextClipId++}`,
      title: file.name,
      sourceLabel: "LOCAL VIDEO",
      status: "ready",
      uploader: "Local file",
      objectUrl,
      videoUrl: objectUrl,
    });
  }
  renderOverview();
  setStatus(`${videos.length} local ${videos.length === 1 ? "clip" : "clips"} added to this review.`);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const urls = urlInput.value.split(/\s+/).filter(Boolean);
  if (!urls.length) {
    urlInput.focus();
    setStatus("Paste one or more Medal links first.", "error");
    return;
  }
  loadButton.disabled = true;
  urlInput.value = "";
  await loadMedalLinks(urls);
});

pasteButton.addEventListener("click", async () => {
  try {
    urlInput.value = (await navigator.clipboard.readText()).trim();
    urlInput.focus();
    setStatus(urlInput.value ? "Link pasted. Ready to load." : "Clipboard is empty.");
  } catch {
    urlInput.focus();
    setStatus("Clipboard access blocked. Paste with Ctrl+V.");
  }
});

fileInput.addEventListener("change", () => {
  addLocalFiles(fileInput.files);
  fileInput.value = "";
});

clearBatchButton.addEventListener("click", () => {
  clearQueue();
  urlInput.value = "";
  setStatus("Batch cleared. Add Medal links or local videos to start a new review.");
  urlInput.focus();
});

dropZone.addEventListener("click", () => fileInput.click());

for (const eventName of ["dragenter", "dragover"]) {
  mainColumn.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  mainColumn.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}
mainColumn.addEventListener("drop", (event) => addLocalFiles(event.dataTransfer.files));

function stopBatchSync() {
  if (batchSyncTimer !== null) {
    clearInterval(batchSyncTimer);
    batchSyncTimer = null;
  }
}

function startBatchSync() {
  stopBatchSync();
  batchSyncTimer = setInterval(() => {
    const videos = getPreviewVideos();
    const reference = videos.find((video) => !video.paused && !video.ended);
    if (!reference) {
      stopBatchSync();
      return;
    }
    for (const video of videos) {
      if (video === reference || video.paused || video.ended || !Number.isFinite(video.duration)) continue;
      if (Math.abs(video.currentTime - reference.currentTime) > 0.2) {
        video.currentTime = Math.min(reference.currentTime, video.duration);
      }
    }
    updateBatchClock();
  }, 250);
}

batchPlayButton.addEventListener("click", playBatch);

batchPauseButton.addEventListener("click", pauseBatch);

batchSeek.addEventListener("input", () => {
  const time = Number(batchSeek.value) / 10;
  seekBatchTo(time);
});

playbackSpeed.addEventListener("change", () => {
  const speed = Number(playbackSpeed.value);
  if (!Number.isFinite(speed) || speed <= 0) return;
  const videos = batchSyncTimer === null
    ? [getFocusedVideo()].filter(Boolean)
    : getPreviewVideos();
  for (const video of videos) video.playbackRate = speed;
});

document.addEventListener("keydown", (event) => {
  if (!clipItems.length || isTypingOrUsingControl(event.target, event.key)) return;
  if (event.code === "Space") {
    event.preventDefault();
    toggleFocusedPlayback();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const reference = getFocusedVideo();
    if (!reference || !Number.isFinite(reference.duration)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    reference.currentTime = Math.max(0, Math.min(
      reference.currentTime + direction * 5,
      reference.duration,
    ));
    updateBatchClock();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    moveFocusedClip(event.key === "ArrowDown" ? 1 : -1, event.target);
  }
});