const form = document.querySelector("#link-form");
const urlInput = document.querySelector("#medal-url");
const pasteButton = document.querySelector("#paste-button");
const loadButton = document.querySelector("#load-button");
const fileInput = document.querySelector("#video-file");
const dropZone = document.querySelector("#drop-zone");
const queueDropTarget = document.querySelector("#queue-drop-target");
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
const zoomDialog = document.querySelector("#zoom-dialog");
const zoomTitle = document.querySelector("#zoom-title");
const zoomStage = document.querySelector("#zoom-stage");
const zoomVideoSlot = document.querySelector("#zoom-video-slot");
const zoomCloseButton = document.querySelector("#zoom-close");
const zoomOutButton = document.querySelector("#zoom-out");
const zoomInButton = document.querySelector("#zoom-in");
const zoomResetButton = document.querySelector("#zoom-reset");
const zoomLevel = document.querySelector("#zoom-level");
const zoomReadout = document.querySelector("#zoom-readout");
const clipItems = [];
let nextClipId = 1;
let batchSyncTimer = null;
let focusedClipId = null;
let deferredInstallPrompt = null;
let zoomedVideo = null;
let zoomOrigin = null;
let zoomTrigger = null;
let zoomScale = 1;
let zoomPanX = 0;
let zoomPanY = 0;
let zoomDrag = null;
let dragDepth = 0;

const videoFileExtensions = new Set([
  ".3g2", ".3gp", ".avi", ".m4v", ".mkv", ".mov", ".mp4", ".ogg", ".ogv", ".webm",
]);

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

function updateZoomTransform() {
  zoomVideoSlot.style.setProperty("--zoom-scale", String(zoomScale));
  zoomVideoSlot.style.setProperty("--zoom-pan-x", `${zoomPanX}px`);
  zoomVideoSlot.style.setProperty("--zoom-pan-y", `${zoomPanY}px`);
  zoomLevel.value = String(zoomScale);
  zoomReadout.textContent = `${zoomScale.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×`;
  zoomOutButton.disabled = zoomScale <= 1;
  zoomInButton.disabled = zoomScale >= 3;
  zoomResetButton.disabled = zoomScale === 1 && zoomPanX === 0 && zoomPanY === 0;
}

function setZoomScale(value) {
  zoomScale = Math.max(1, Math.min(3, value));
  if (zoomScale === 1) {
    zoomPanX = 0;
    zoomPanY = 0;
  }
  updateZoomTransform();
}

function closeZoomView() {
  if (zoomDialog.open) {
    zoomDialog.close();
    finishZoomView();
    return;
  }
  if (!zoomedVideo) return;
  finishZoomView();
}

function finishZoomView() {
  if (zoomedVideo && zoomOrigin) {
    zoomOrigin.append(zoomedVideo);
    zoomOrigin.classList.remove("is-zooming");
  }
  zoomVideoSlot.replaceChildren();
  zoomedVideo = null;
  zoomOrigin = null;
  zoomPanX = 0;
  zoomPanY = 0;
  zoomDrag = null;
  updateZoomTransform();
  zoomTrigger?.focus({ preventScroll: true });
  zoomTrigger = null;
}

function openZoomView(item, video, origin, trigger) {
  if (zoomDialog.open) closeZoomView();
  focusedClipId = item.id;
  syncFocusView();
  zoomedVideo = video;
  zoomOrigin = origin;
  zoomTrigger = trigger;
  zoomTitle.textContent = item.title;
  zoomScale = 1;
  zoomPanX = 0;
  zoomPanY = 0;
  origin.classList.add("is-zooming");
  zoomVideoSlot.append(video);
  updateZoomTransform();
  zoomDialog.showModal();
  zoomCloseButton.focus();
}

function panZoomVideo(deltaX, deltaY) {
  const bounds = zoomStage.getBoundingClientRect();
  const maxX = bounds.width * (zoomScale - 1) / 2;
  const maxY = bounds.height * (zoomScale - 1) / 2;
  zoomPanX = Math.max(-maxX, Math.min(maxX, zoomPanX + deltaX));
  zoomPanY = Math.max(-maxY, Math.min(maxY, zoomPanY + deltaY));
  updateZoomTransform();
}

zoomDialog.addEventListener("close", finishZoomView);
zoomDialog.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeZoomView();
});
zoomDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeZoomView();
});
zoomCloseButton.addEventListener("click", closeZoomView);
zoomOutButton.addEventListener("click", () => setZoomScale(zoomScale - 0.25));
zoomInButton.addEventListener("click", () => setZoomScale(zoomScale + 0.25));
zoomResetButton.addEventListener("click", () => {
  zoomPanX = 0;
  zoomPanY = 0;
  setZoomScale(1);
});
zoomLevel.addEventListener("input", () => setZoomScale(Number(zoomLevel.value)));
zoomDialog.addEventListener("click", (event) => {
  if (event.target === zoomDialog) closeZoomView();
});
zoomStage.addEventListener("wheel", (event) => {
  event.preventDefault();
  setZoomScale(zoomScale + (event.deltaY < 0 ? 0.25 : -0.25));
}, { passive: false });
zoomStage.addEventListener("pointerdown", (event) => {
  if (!event.shiftKey || zoomScale <= 1) return;
  event.preventDefault();
  zoomDrag = { x: event.clientX, y: event.clientY };
  zoomStage.setPointerCapture(event.pointerId);
  zoomStage.classList.add("is-panning");
});
zoomStage.addEventListener("pointermove", (event) => {
  if (!zoomDrag) return;
  panZoomVideo(event.clientX - zoomDrag.x, event.clientY - zoomDrag.y);
  zoomDrag = { x: event.clientX, y: event.clientY };
});
function endZoomPan() {
  zoomDrag = null;
  zoomStage.classList.remove("is-panning");
}
zoomStage.addEventListener("pointerup", endZoomPan);
zoomStage.addEventListener("pointercancel", endZoomPan);

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "Length unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function getPreviewVideos() {
  return Array.from(document.querySelectorAll(".overview-media video, #zoom-video-slot video"));
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
  return videos.find((video) => video.dataset.clipId === focusedClipId) || null;
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
  const playingItem = getBatchReferenceVideo()?.dataset.clipId;
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

function reorderFocusedClip(direction) {
  if (!focusedClipId) return;
  const card = overviewGrid.querySelector(`[data-clip-id="${CSS.escape(focusedClipId)}"]`);
  const button = card?.querySelector(direction < 0
    ? ".overview-move[title='Move clip up']"
    : ".overview-move[title='Move clip down']");
  if (button && !button.disabled) moveClip(focusedClipId, direction, button);
}

function isTypingOrUsingControl(target, key) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, a, video, [contenteditable='true'], [role='slider']")) return true;
  const button = target.closest("button");
  if (!button) return false;
  return !(["ArrowUp", "ArrowDown"].includes(key) && button.matches(".overview-focus, .overview-move"));
}

function clearQueue() {
  closeZoomView();
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
  closeZoomView();
  const total = clipItems.length;
  const ready = clipItems.filter((item) => item.status === "ready").length;
  document.body.classList.toggle("batch-active", total > 0);
  clipOverview.hidden = total === 0;
  dropZone.hidden = total > 0;
  queueDropTarget.hidden = total === 0;
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
      preview.dataset.clipId = item.id;
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
      const zoomButton = document.createElement("button");
      zoomButton.type = "button";
      zoomButton.className = "overview-zoom";
      zoomButton.textContent = "ZOOM";
      zoomButton.setAttribute("aria-label", `Zoom in on ${item.title}`);
      zoomButton.addEventListener("click", () => openZoomView(item, preview, media, zoomButton));
      media.append(zoomButton);
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
  if (zoomedVideo?.dataset.clipId === clipId) closeZoomView();
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
  const droppedFiles = Array.from(files);
  const videos = droppedFiles.filter((file) => {
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    return file.type.startsWith("video/") || videoFileExtensions.has(extension);
  });
  if (!videos.length) {
    setStatus("No video files found. Drop video clips or use Choose videos.", "error");
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
  const skipped = droppedFiles.length - videos.length;
  setStatus(
    `${videos.length} local ${videos.length === 1 ? "clip" : "clips"} added to this review.${skipped ? ` ${skipped} non-video ${skipped === 1 ? "file was" : "files were"} skipped.` : ""}`,
  );
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
queueDropTarget.addEventListener("click", () => fileInput.click());

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function clearFileDragState() {
  dragDepth = 0;
  dropZone.classList.remove("dragging");
  queueDropTarget.classList.remove("dragging");
}

function highlightFileDropTargets() {
  dropZone.classList.add("dragging");
  queueDropTarget.classList.add("dragging");
}

mainColumn.addEventListener("dragenter", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth += 1;
  highlightFileDropTargets();
});

mainColumn.addEventListener("dragover", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  highlightFileDropTargets();
});

mainColumn.addEventListener("dragleave", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropZone.classList.remove("dragging");
});

mainColumn.addEventListener("drop", (event) => {
  if (!isFileDrag(event) && !event.dataTransfer?.files.length) return;
  event.preventDefault();
  clearFileDragState();
  addLocalFiles(event.dataTransfer.files);
});

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
  if (zoomDialog.open) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeZoomView();
    }
    return;
  }
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
  } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    reorderFocusedClip(event.key === "ArrowUp" ? -1 : 1);
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    moveFocusedClip(event.key === "ArrowDown" ? 1 : -1, event.target);
  }
});