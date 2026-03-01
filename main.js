const imageInput = document.getElementById("imageInput");
const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const keepRatio = document.getElementById("keepRatio");
const targetSizeInput = document.getElementById("targetSizeInput");
const formatSelect = document.getElementById("formatSelect");
const processBtn = document.getElementById("processBtn");
const downloadLink = document.getElementById("downloadLink");
const imagePreview = document.getElementById("imagePreview");
const imagePreviewWrap = document.getElementById("imagePreviewWrap");
const imageInfo = document.getElementById("imageInfo");
const resultInfo = document.getElementById("resultInfo");

const spellInput = document.getElementById("spellInput");
const checkSpellBtn = document.getElementById("checkSpellBtn");
const spellSummary = document.getElementById("spellSummary");
const spellOutput = document.getElementById("spellOutput");

let originalImage = {
  file: null,
  url: "",
  width: 0,
  height: 0,
};

let lastCorrection = "";
let processedImageUrl = "";
let correctionCandidates = [];
let selectedCorrectionIds = new Set();
let currentOriginalText = "";

const SPELL_RULES = [
  { wrong: "않", correct: "안", hint: "부정 표현은 보통 '안'을 씁니다." },
  { wrong: "됬", correct: "됐", hint: "과거형은 '됐'을 씁니다." },
  { wrong: "웬지", correct: "왠지", hint: "표준어는 '왠지'입니다." },
  { wrong: "몇일", correct: "며칠", hint: "날짜 단위는 '며칠'이 맞습니다." },
  { wrong: "되는데로", correct: "되는 대로", hint: "'-는 대로'로 띄어 씁니다." },
  { wrong: "할수", correct: "할 수", hint: "의존 명사 '수'는 띄어 씁니다." },
  { wrong: "할께", correct: "할게", hint: "종결 표현은 '할게'가 맞습니다." },
  { wrong: "맞추다", correct: "맞히다", hint: "정답/타깃을 맞출 때는 '맞히다'를 씁니다.", weak: true },
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
  imageInput.click();
});

imagePreviewWrap.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
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

  widthInput.value = String(dim.width);
  heightInput.value = String(dim.height);
  imagePreview.src = url;
  imagePreviewWrap.classList.remove("empty");
  imageInfo.textContent = `원본 정보: ${dim.width} x ${dim.height}px / ${formatBytes(file.size)}`;
  resultInfo.textContent = "변환 결과: -";
  downloadLink.classList.add("disabled");
  downloadLink.removeAttribute("href");
  if (processedImageUrl) {
    URL.revokeObjectURL(processedImageUrl);
    processedImageUrl = "";
  }
}

widthInput.addEventListener("input", () => {
  if (!keepRatio.checked || !originalImage.width || !originalImage.height) {
    return;
  }
  const nextWidth = Number(widthInput.value);
  if (!nextWidth) {
    return;
  }
  const nextHeight = Math.round((nextWidth * originalImage.height) / originalImage.width);
  heightInput.value = String(nextHeight);
});

heightInput.addEventListener("input", () => {
  if (!keepRatio.checked || !originalImage.width || !originalImage.height) {
    return;
  }
  const nextHeight = Number(heightInput.value);
  if (!nextHeight) {
    return;
  }
  const nextWidth = Math.round((nextHeight * originalImage.width) / originalImage.height);
  widthInput.value = String(nextWidth);
});

processBtn.addEventListener("click", async () => {
  if (!originalImage.file) {
    alert("먼저 이미지를 업로드해 주세요.");
    return;
  }

  const width = Number(widthInput.value) || originalImage.width;
  const height = Number(heightInput.value) || originalImage.height;
  const mimeType = formatSelect.value;
  const targetKB = Number(targetSizeInput.value) || 0;

  const img = await loadImage(originalImage.url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  try {
    const blob = await makeTargetBlob(canvas, mimeType, targetKB);
    const outputUrl = URL.createObjectURL(blob);
    if (processedImageUrl) {
      URL.revokeObjectURL(processedImageUrl);
    }
    processedImageUrl = outputUrl;
    imagePreview.src = outputUrl;

    downloadLink.href = outputUrl;
    downloadLink.download = `resume-photo.${getExt(mimeType)}`;
    downloadLink.classList.remove("disabled");

    resultInfo.textContent = `변환 결과: ${canvas.width} x ${canvas.height}px / ${formatBytes(blob.size)} / ${mimeType}`;
  } catch (error) {
    alert("이미지 변환 중 오류가 발생했습니다.");
    console.error(error);
  }
});

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
      corrected: text,
      highlighted: "",
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

  const highlighted = buildHighlight(text, issues);

  return {
    issues,
    corrected,
    highlighted,
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
    corrected: data.corrected ?? text,
    issues: data.issues ?? [],
    highlighted: data.highlighted ?? escapeHtml(text),
  };
}

function renderSpellReport(report, isFallback = false) {
  lastCorrection = report.corrected;
  correctionCandidates = buildCorrectionCandidates(currentOriginalText, report.issues);
  const suffix = isFallback ? " (로컬 규칙 기반 결과)" : "";
  spellSummary.textContent = `검사 결과: ${correctionCandidates.length}건 발견${suffix} / 교정안을 클릭하면 즉시 반영됩니다.`;
  spellOutput.innerHTML = renderProofText(currentOriginalText, correctionCandidates);
  bindProofMarkEvents();
  spellInput.value = currentOriginalText;
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

function buildHighlight(original, issues) {
  if (!issues.length) {
    return escapeHtml(original);
  }

  const sorted = [...issues].sort((a, b) => b.wrong.length - a.wrong.length);
  let html = escapeHtml(original);

  sorted.forEach((issue) => {
    const escaped = escapeRegExp(escapeHtml(issue.wrong));
    const regex = new RegExp(escaped, "g");
    html = html.replace(regex, `<span class="mark">${escapeHtml(issue.wrong)}</span>`);
  });

  return html;
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

async function makeTargetBlob(canvas, mimeType, targetKB) {
  // PNG는 quality 인자를 사용하지 않으므로 바로 생성
  if (!targetKB || mimeType === "image/png") {
    return canvasToBlob(canvas, mimeType, 0.92);
  }

  const targetBytes = targetKB * 1024;
  let min = 0.2;
  let max = 0.95;
  let best = await canvasToBlob(canvas, mimeType, max);

  if (best.size <= targetBytes) {
    return best;
  }

  for (let i = 0; i < 8; i += 1) {
    const mid = (min + max) / 2;
    const blob = await canvasToBlob(canvas, mimeType, mid);

    if (blob.size > targetBytes) {
      max = mid;
    } else {
      min = mid;
      best = blob;
    }
  }

  return best;
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
