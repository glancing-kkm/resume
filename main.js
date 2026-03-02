const imageInput = document.getElementById("imageInput");
const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const keepRatio = document.getElementById("keepRatio");
const cropPreset = document.getElementById("cropPreset");
const targetSizeInput = document.getElementById("targetSizeInput");
const formatSelect = document.getElementById("formatSelect");
const processBtn = document.getElementById("processBtn");
const downloadLink = document.getElementById("downloadLink");
const imagePreview = document.getElementById("imagePreview");
const imagePreviewWrap = document.getElementById("imagePreviewWrap");
const imageStage = document.getElementById("imageStage");
const cropFrame = document.getElementById("cropFrame");
const cropSizeLabel = document.getElementById("cropSizeLabel");
const imageInfo = document.getElementById("imageInfo");
const resultInfo = document.getElementById("resultInfo");

const spellInput = document.getElementById("spellInput");
const checkSpellBtn = document.getElementById("checkSpellBtn");
const spellSummary = document.getElementById("spellSummary");
const spellOutput = document.getElementById("spellOutput");
const spellCharCount = document.getElementById("spellCharCount");

let originalImage = {
  file: null,
  url: "",
  width: 0,
  height: 0,
};

let processedImageUrl = "";
let correctionCandidates = [];
let selectedCorrectionIds = new Set();
let currentOriginalText = "";
let cropState = {
  scale: 1,
  displayWidth: 0,
  displayHeight: 0,
  panX: 0,
  panY: 0,
};
let dragState = {
  active: false,
  startX: 0,
  startY: 0,
  basePanX: 0,
  basePanY: 0,
};
let applyingPreset = false;

const CROP_PRESETS = {
  "3x4": { width: 300, height: 400 },
  "4x5": { width: 400, height: 500 },
  "1x1": { width: 500, height: 500 },
  passport: { width: 350, height: 450 },
};

const SPELL_RULES = [
  { wrong: "않", correct: "안", hint: "부정 표현은 보통 '안'을 씁니다." },
  { wrong: "됬", correct: "됐", hint: "과거형은 '됐'을 씁니다." },
  { wrong: "웬지", correct: "왠지", hint: "표준어는 '왠지'입니다." },
  { wrong: "몇일", correct: "며칠", hint: "날짜 단위는 '며칠'이 맞습니다." },
  { wrong: "되는데로", correct: "되는 대로", hint: "'-는 대로'로 띄어 씁니다." },
  { wrong: "할수", correct: "할 수", hint: "의존 명사 '수'는 띄어 씁니다." },
  { wrong: "할께", correct: "할게", hint: "종결 표현은 '할게'가 맞습니다." },
  { wrong: "맞추다", correct: "맞히다", hint: "정답/타깃을 맞출 때는 '맞히다'를 씁니다." },
  { wrong: "바램", correct: "바람", hint: "명사는 '바람'이 맞습니다." },
  { wrong: "오랫만", correct: "오랜만", hint: "표준어는 '오랜만'입니다." },
  { wrong: "금새", correct: "금세", hint: "표준어는 '금세'입니다." },
  { wrong: "안되", correct: "안 돼", hint: "부정 + 되다는 보통 '안 돼'로 띄어 씁니다." },
  { wrong: "되요", correct: "돼요", hint: "어미 결합은 '돼요'가 맞습니다." },
];

imageInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  await handleImageFile(file);
});

imagePreviewWrap.addEventListener("click", () => {
  if (!imagePreviewWrap.classList.contains("empty")) {
    return;
  }
  imageInput.click();
});

imagePreviewWrap.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!imagePreviewWrap.classList.contains("empty")) {
      return;
    }
    imageInput.click();
  }
});

imagePreviewWrap.addEventListener("dragover", (event) => {
  event.preventDefault();
  imagePreviewWrap.classList.add("dragover");
});

imagePreviewWrap.addEventListener("dragleave", () => {
  imagePreviewWrap.classList.remove("dragover");
});

imagePreviewWrap.addEventListener("drop", async (event) => {
  event.preventDefault();
  imagePreviewWrap.classList.remove("dragover");
  const [file] = event.dataTransfer?.files || [];
  await handleImageFile(file);
});

imageStage.addEventListener("pointerdown", (event) => {
  if (imagePreviewWrap.classList.contains("empty")) {
    return;
  }
  dragState.active = true;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.basePanX = cropState.panX;
  dragState.basePanY = cropState.panY;
  imagePreviewWrap.classList.add("dragging");
  imageStage.setPointerCapture(event.pointerId);
});

imageStage.addEventListener("pointermove", (event) => {
  if (!dragState.active) {
    return;
  }

  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  cropState.panX = dragState.basePanX + dx;
  cropState.panY = dragState.basePanY + dy;
  clampPanToCropBounds();
  renderImageStage();
});

imageStage.addEventListener("pointerup", (event) => {
  if (!dragState.active) {
    return;
  }
  dragState.active = false;
  imagePreviewWrap.classList.remove("dragging");
  imageStage.releasePointerCapture(event.pointerId);
});

imageStage.addEventListener("pointercancel", () => {
  dragState.active = false;
  imagePreviewWrap.classList.remove("dragging");
});

window.addEventListener("resize", () => {
  if (!originalImage.width || !originalImage.height) {
    return;
  }
  recalcDisplayLayout();
  clampPanToCropBounds();
  renderImageStage();
});

async function handleImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    return;
  }
  if (originalImage.url) {
    URL.revokeObjectURL(originalImage.url);
  }

  const url = URL.createObjectURL(file);
  const dim = await getImageDimensions(url);

  originalImage = {
    file,
    url,
    width: dim.width,
    height: dim.height,
  };

  if (cropPreset.value !== "custom") {
    applySelectedPreset();
  } else {
    widthInput.value = String(dim.width);
    heightInput.value = String(dim.height);
  }
  imagePreview.src = url;
  imagePreviewWrap.classList.remove("empty");
  imagePreviewWrap.classList.add("draggable");
  imageInfo.textContent = `원본 정보: ${dim.width} x ${dim.height}px / ${formatBytes(file.size)}`;
  resultInfo.textContent = "변환 결과: - (크롭 기준)";
  downloadLink.classList.add("disabled");
  downloadLink.removeAttribute("href");
  if (processedImageUrl) {
    URL.revokeObjectURL(processedImageUrl);
    processedImageUrl = "";
  }
  cropState.panX = 0;
  cropState.panY = 0;
  recalcDisplayLayout();
  clampPanToCropBounds();
  renderImageStage();
}

widthInput.addEventListener("input", () => {
  if (!applyingPreset) {
    cropPreset.value = "custom";
  }
  if (!keepRatio.checked || !originalImage.width || !originalImage.height) {
    recalcDisplayLayout();
    clampPanToCropBounds();
    renderImageStage();
    return;
  }
  const nextWidth = Number(widthInput.value);
  if (!nextWidth) {
    recalcDisplayLayout();
    clampPanToCropBounds();
    renderImageStage();
    return;
  }
  const nextHeight = Math.round((nextWidth * originalImage.height) / originalImage.width);
  heightInput.value = String(nextHeight);
  recalcDisplayLayout();
  clampPanToCropBounds();
  renderImageStage();
});

heightInput.addEventListener("input", () => {
  if (!applyingPreset) {
    cropPreset.value = "custom";
  }
  if (!keepRatio.checked || !originalImage.width || !originalImage.height) {
    recalcDisplayLayout();
    clampPanToCropBounds();
    renderImageStage();
    return;
  }
  const nextHeight = Number(heightInput.value);
  if (!nextHeight) {
    recalcDisplayLayout();
    clampPanToCropBounds();
    renderImageStage();
    return;
  }
  const nextWidth = Math.round((nextHeight * originalImage.width) / originalImage.height);
  widthInput.value = String(nextWidth);
  recalcDisplayLayout();
  clampPanToCropBounds();
  renderImageStage();
});

keepRatio.addEventListener("change", () => {
  recalcDisplayLayout();
  clampPanToCropBounds();
  renderImageStage();
});

cropPreset.addEventListener("change", () => {
  applySelectedPreset();
});

processBtn.addEventListener("click", async () => {
  if (!originalImage.file) {
    alert("먼저 이미지를 업로드해 주세요.");
    return;
  }

  const width = Math.min(Math.max(1, Number(widthInput.value) || originalImage.width), originalImage.width);
  const height = Math.min(Math.max(1, Number(heightInput.value) || originalImage.height), originalImage.height);
  const mimeType = formatSelect.value;
  const rawTargetKB = targetSizeInput.value.trim();
  const targetKB = rawTargetKB ? Number(rawTargetKB) : null;
  if (rawTargetKB && (!Number.isFinite(targetKB) || targetKB <= 0)) {
    alert("최대 용량(KB)은 1 이상의 숫자로 입력해 주세요.");
    return;
  }

  const img = await loadImage(originalImage.url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);

  const crop = getCropRectForExport(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);

  try {
    const blob = await makeTargetBlob(canvas, mimeType, targetKB, originalImage.file.size);
    const outputUrl = URL.createObjectURL(blob);
    if (processedImageUrl) {
      URL.revokeObjectURL(processedImageUrl);
    }
    processedImageUrl = outputUrl;

    downloadLink.href = outputUrl;
    downloadLink.download = `resume-photo.${getExt(mimeType)}`;
    downloadLink.classList.remove("disabled");

    const sizeGuide = targetKB ? `입력 용량 ${targetKB}KB 기준` : "원본 용량 기준";
    resultInfo.textContent = `변환 결과: ${canvas.width} x ${canvas.height}px / ${formatBytes(blob.size)} / ${mimeType} (${sizeGuide}, 중앙 기준 크롭, 위치 조정 반영)`;
  } catch (error) {
    alert("이미지 변환 중 오류가 발생했습니다.");
    console.error(error);
  }
});

spellInput.addEventListener("input", () => {
  updateSpellCharCount();
});

updateSpellCharCount();

function updateSpellCharCount() {
  spellCharCount.textContent = `글자 수(공백 포함): ${spellInput.value.length}자`;
}

function applySelectedPreset() {
  const preset = CROP_PRESETS[cropPreset.value];
  applyingPreset = true;

  if (!preset) {
    if (originalImage.width && originalImage.height) {
      widthInput.value = String(originalImage.width);
      heightInput.value = String(originalImage.height);
    }
  } else if (originalImage.width && originalImage.height) {
    const fitted = fitPresetToOriginal(preset.width, preset.height, originalImage.width, originalImage.height);
    widthInput.value = String(fitted.width);
    heightInput.value = String(fitted.height);
    keepRatio.checked = true;
  } else {
    widthInput.value = String(preset.width);
    heightInput.value = String(preset.height);
    keepRatio.checked = true;
  }

  applyingPreset = false;
  recalcDisplayLayout();
  clampPanToCropBounds();
  renderImageStage();
}

function fitPresetToOriginal(presetWidth, presetHeight, originalWidth, originalHeight) {
  const scale = Math.min(originalWidth / presetWidth, originalHeight / presetHeight);
  const width = Math.max(1, Math.floor(presetWidth * scale));
  const height = Math.max(1, Math.floor(presetHeight * scale));
  return { width, height };
}

function recalcDisplayLayout() {
  if (!originalImage.width || !originalImage.height) {
    return;
  }

  const stageRect = imageStage.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height) {
    return;
  }

  const scale = Math.min(stageRect.width / originalImage.width, stageRect.height / originalImage.height);
  cropState.scale = scale;
  cropState.displayWidth = originalImage.width * scale;
  cropState.displayHeight = originalImage.height * scale;
}

function getRequestedCropSize() {
  const requestedWidth = Math.max(1, Number(widthInput.value) || originalImage.width || 1);
  const requestedHeight = Math.max(1, Number(heightInput.value) || originalImage.height || 1);
  const width = Math.min(requestedWidth, originalImage.width || requestedWidth);
  const height = Math.min(requestedHeight, originalImage.height || requestedHeight);
  return { width, height, clipped: requestedWidth > width || requestedHeight > height };
}

function clampPanToCropBounds() {
  if (!originalImage.width || !originalImage.height) {
    return;
  }

  const { width, height } = getRequestedCropSize();
  const cropDisplayWidth = width * cropState.scale;
  const cropDisplayHeight = height * cropState.scale;

  const maxPanX = Math.max(0, (cropState.displayWidth - cropDisplayWidth) / 2);
  const maxPanY = Math.max(0, (cropState.displayHeight - cropDisplayHeight) / 2);

  cropState.panX = clamp(cropState.panX, -maxPanX, maxPanX);
  cropState.panY = clamp(cropState.panY, -maxPanY, maxPanY);
}

function renderImageStage() {
  if (!originalImage.width || !originalImage.height || !cropState.displayWidth || !cropState.displayHeight) {
    return;
  }

  const stageRect = imageStage.getBoundingClientRect();
  const centerX = stageRect.width / 2;
  const centerY = stageRect.height / 2;
  const { width, height, clipped } = getRequestedCropSize();

  const displayWidth = cropState.displayWidth;
  const displayHeight = cropState.displayHeight;
  const cropDisplayWidth = width * cropState.scale;
  const cropDisplayHeight = height * cropState.scale;

  const imageLeft = centerX - displayWidth / 2 + cropState.panX;
  const imageTop = centerY - displayHeight / 2 + cropState.panY;

  imagePreview.style.width = `${displayWidth}px`;
  imagePreview.style.height = `${displayHeight}px`;
  imagePreview.style.left = `${imageLeft}px`;
  imagePreview.style.top = `${imageTop}px`;

  cropFrame.style.width = `${cropDisplayWidth}px`;
  cropFrame.style.height = `${cropDisplayHeight}px`;
  cropFrame.style.left = `${centerX - cropDisplayWidth / 2}px`;
  cropFrame.style.top = `${centerY - cropDisplayHeight / 2}px`;
  cropSizeLabel.textContent = clipped ? `${width} x ${height}px (원본 범위로 제한)` : `${width} x ${height}px`;
}

function getCropRectForExport(width, height) {
  const stageRect = imageStage.getBoundingClientRect();
  const centerX = stageRect.width / 2;
  const centerY = stageRect.height / 2;
  const imageLeft = centerX - cropState.displayWidth / 2 + cropState.panX;
  const imageTop = centerY - cropState.displayHeight / 2 + cropState.panY;
  const cropLeft = centerX - (width * cropState.scale) / 2;
  const cropTop = centerY - (height * cropState.scale) / 2;

  const sx = clamp((cropLeft - imageLeft) / cropState.scale, 0, Math.max(0, originalImage.width - width));
  const sy = clamp((cropTop - imageTop) / cropState.scale, 0, Math.max(0, originalImage.height - height));

  return {
    sx: Math.round(sx),
    sy: Math.round(sy),
    sw: width,
    sh: height,
  };
}

checkSpellBtn.addEventListener("click", async () => {
  const text = spellInput.value.trim();
  if (!text) {
    spellSummary.textContent = "검사 결과: 입력된 문장이 없습니다.";
    spellOutput.textContent = "검사할 문장을 입력해 주세요.";
    return;
  }

  currentOriginalText = text;
  selectedCorrectionIds = new Set();
  correctionCandidates = [];
  spellSummary.textContent = "검사 결과: API 검사 중...";
  spellOutput.textContent = "교정 중입니다. 잠시만 기다려 주세요.";

  try {
    const report = await runSpellCheckViaApi(text);
    renderSpellReport(report);
    return;
  } catch (error) {
    // API 실패 시 기존 규칙 기반 검사로 자동 폴백
    const fallbackReport = runSpellCheck(text);
    renderSpellReport(fallbackReport, true);
    console.error(error);
  }
});

function runSpellCheck(text) {
  if (!text.trim()) {
    return {
      issues: [],
    };
  }

  let corrected = text;
  const issues = [];

  SPELL_RULES.forEach((rule) => {
    const escaped = escapeRegExp(rule.wrong);
    const regex = new RegExp(escaped, "g");

    let found = false;
    corrected = corrected.replace(regex, () => {
      found = true;
      return rule.correct;
    });

    if (found) {
      issues.push(rule);
    }
  });

  // 문맥상 흔한 띄어쓰기 보정
  const spacingRules = [
    { regex: /이력서를준비/g, from: "이력서를준비", to: "이력서를 준비", hint: "조사 다음 용언은 띄어 씁니다." },
    { regex: /사진을수정/g, from: "사진을수정", to: "사진을 수정", hint: "조사 다음 용언은 띄어 씁니다." },
  ];

  spacingRules.forEach((rule) => {
    if (rule.regex.test(corrected)) {
      corrected = corrected.replace(rule.regex, rule.to);
      issues.push({ wrong: rule.from, correct: rule.to, hint: rule.hint });
    }
  });

  return {
    issues,
  };
}

async function runSpellCheckViaApi(text) {
  const response = await fetch("/api/spell-check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`맞춤법 API 호출 실패: ${response.status}`);
  }

  const data = await response.json();
  return {
    issues: data.issues ?? [],
  };
}

function renderSpellReport(report, isFallback = false) {
  correctionCandidates = buildCorrectionCandidates(currentOriginalText, report.issues);
  const suffix = isFallback ? " (로컬 규칙 기반 결과)" : "";
  spellSummary.textContent = `검사 결과: ${correctionCandidates.length}건 발견${suffix} / 교정안을 클릭하면 즉시 반영됩니다.`;
  spellOutput.innerHTML = renderProofText(currentOriginalText, correctionCandidates);
  bindProofMarkEvents();
  spellInput.value = currentOriginalText;
  updateSpellCharCount();
}

function buildCorrectionCandidates(original, issues) {
  if (!issues.length) {
    return [];
  }

  const candidates = [];
  const occupied = [];

  issues.forEach((issue, index) => {
    const wrong = String(issue.wrong || "");
    const correct = String(issue.correct || "");
    if (!wrong || wrong === correct) {
      return;
    }

    const start = findNonOverlappingIndex(original, wrong, occupied);
    if (start < 0) {
      return;
    }

    const end = start + wrong.length;
    for (let i = start; i < end; i += 1) {
      occupied[i] = true;
    }

    candidates.push({
      id: `${index}-${start}-${wrong}`,
      start,
      end,
      wrong,
      correct,
      hint: issue.hint || issue.reason || "교정 제안",
      mark: classifyCorrectionMark(wrong, correct, issue.hint || issue.reason || ""),
    });
  });

  return candidates.sort((a, b) => a.start - b.start);
}

function findNonOverlappingIndex(text, keyword, occupied) {
  let from = 0;
  while (from < text.length) {
    const idx = text.indexOf(keyword, from);
    if (idx < 0) {
      return -1;
    }
    const end = idx + keyword.length;
    let overlaps = false;
    for (let i = idx; i < end; i += 1) {
      if (occupied[i]) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      return idx;
    }
    from = idx + 1;
  }
  return -1;
}

function renderProofText(original, candidates) {
  if (!candidates.length) {
    return escapeHtml(original);
  }

  let cursor = 0;
  let html = "";

  candidates.forEach((item) => {
    html += escapeHtml(original.slice(cursor, item.start));
    html += `<span class="proof-unit">`;
    html += `<span class="proof-wrong">${escapeHtml(item.wrong)}</span>`;
    html += `<button class="proof-mark proof-mark-${item.mark.kind}" type="button" data-correction-id="${item.id}" title="${escapeHtml(`${item.mark.label}: ${item.hint}`)}"><span class="proof-caret">${escapeHtml(item.mark.symbol)}</span>${escapeHtml(item.correct)}</button>`;
    html += `</span>`;
    cursor = item.end;
  });

  html += escapeHtml(original.slice(cursor));
  return html;
}

function bindProofMarkEvents() {
  const buttons = spellOutput.querySelectorAll(".proof-mark");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.correctionId;
      if (!id) {
        return;
      }
      if (selectedCorrectionIds.has(id)) {
        selectedCorrectionIds.delete(id);
      } else {
        selectedCorrectionIds.add(id);
      }
      btn.classList.toggle("active", selectedCorrectionIds.has(id));
      const immediateText = buildAppliedText();
      spellInput.value = immediateText;
      updateSpellCharCount();
      spellSummary.textContent = `검사 결과: ${correctionCandidates.length}건 발견 / ${selectedCorrectionIds.size}건 반영 중`;
    });
  });
}

function buildAppliedText() {
  if (!currentOriginalText) {
    return "";
  }

  if (!correctionCandidates.length || !selectedCorrectionIds.size) {
    return currentOriginalText;
  }

  let cursor = 0;
  let result = "";
  correctionCandidates.forEach((item) => {
    result += currentOriginalText.slice(cursor, item.start);
    result += selectedCorrectionIds.has(item.id) ? item.correct : item.wrong;
    cursor = item.end;
  });
  result += currentOriginalText.slice(cursor);
  return result;
}

function classifyCorrectionMark(wrong, correct, hint) {
  const w = String(wrong || "");
  const c = String(correct || "");
  const h = String(hint || "");

  if (!w.includes(" ") && c.includes(" ")) {
    return { symbol: "␠+", kind: "space-add", label: "띄어쓰기 삽입" };
  }
  if (w.includes(" ") && !c.includes(" ")) {
    return { symbol: "␠−", kind: "space-remove", label: "띄어쓰기 제거" };
  }
  if (/조사|어미|활용|문법/.test(h)) {
    return { symbol: "⌒", kind: "grammar", label: "문법/활용 보정" };
  }
  return { symbol: "∧", kind: "replace", label: "일반 치환" };
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Blob 생성 실패"));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}

async function makeTargetBlob(canvas, mimeType, targetKB, originalBytes = 0) {
  // 용량 입력이 없으면 원본 용량을 상한으로 맞춰 저장
  if (!targetKB) {
    if (mimeType === "image/png") {
      return canvasToBlob(canvas, mimeType, 1);
    }
    let best = await canvasToBlob(canvas, mimeType, 0.98);
    if (!originalBytes || best.size <= originalBytes) {
      return best;
    }
    const fitted = await fitBlobToMaxBytes(canvas, mimeType, originalBytes, 0.2, 0.98, best);
    return fitted || best;
  }

  // PNG는 quality 인자를 사용하지 않으므로 바로 생성
  if (mimeType === "image/png") {
    return canvasToBlob(canvas, mimeType, 1);
  }

  const targetBytes = targetKB * 1024;
  const fitted = await fitBlobToMaxBytes(canvas, mimeType, targetBytes, 0.2, 0.95);
  if (fitted) {
    return fitted;
  }

  // 아주 낮은 목표 용량으로 인해 목표치 미달 시 가능한 최소 품질 결과를 반환
  return canvasToBlob(canvas, mimeType, 0.2);
}

async function fitBlobToMaxBytes(canvas, mimeType, maxBytes, minQuality, maxQuality, initialBest = null) {
  let min = minQuality;
  let max = maxQuality;
  let best = initialBest || await canvasToBlob(canvas, mimeType, max);

  if (best.size <= maxBytes) {
    return best;
  }

  for (let i = 0; i < 10; i += 1) {
    const mid = (min + max) / 2;
    const blob = await canvasToBlob(canvas, mimeType, mid);

    if (blob.size > maxBytes) {
      max = mid;
    } else {
      min = mid;
      best = blob;
    }
  }

  const minBlob = await canvasToBlob(canvas, mimeType, minQuality);
  if (minBlob.size > maxBytes) {
    return null;
  }
  return best.size <= maxBytes ? best : minBlob;
}

function getExt(mimeType) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return map[mimeType] || "img";
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
