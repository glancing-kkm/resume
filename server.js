const http = require("http");
const fs = require("fs");
const path = require("path");

loadDotEnv(path.join(__dirname, ".env"));

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const CACHE_TTL_MS = Number(process.env.SPELL_CACHE_TTL_MS || 10 * 60 * 1000);
const spellCache = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/spell-check") {
      await handleSpellCheck(req, res);
      return;
    }

    if (req.method !== "GET") {
      json(res, 405, { error: "Method Not Allowed" });
      return;
    }

    const requestPath = req.url === "/" ? "/index.html" : req.url;
    const safePath = path.normalize(requestPath).replace(/^\.\.([/\\]|$)/, "");
    const filePath = path.resolve(ROOT_DIR, `.${safePath}`);

    if (filePath !== ROOT_DIR && !filePath.startsWith(`${ROOT_DIR}${path.sep}`)) {
      json(res, 403, { error: "Forbidden" });
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        json(res, 404, { error: "Not Found" });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const type = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Internal Server Error" });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

async function handleSpellCheck(req, res) {
  const rawBody = await readBody(req);

  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const text = String(payload.text || "").trim();
  if (!text) {
    json(res, 400, { error: "text is required" });
    return;
  }

  const cacheKey = `${OPENAI_MODEL}:${normalizeForCache(text)}`;
  const cached = getCachedSpell(cacheKey);
  if (cached) {
    json(res, 200, { ...cached, cached: true });
    return;
  }

  if (!OPENAI_API_KEY) {
    json(res, 500, {
      error: "OPENAI_API_KEY is not set",
      hint: "서버 실행 전에 OPENAI_API_KEY 환경변수를 설정해 주세요.",
    });
    return;
  }

  const prompt = [
    "너는 한국어 교정 전문가다.",
    "다음 문장을 맞춤법, 띄어쓰기, 문법 기준으로 교정한다.",
    "중요 우선순위:",
    "1) 띄어쓰기 오류를 먼저 정확히 교정",
    "2) 맞춤법/어미/조사 오류 교정",
    "3) 의미를 바꾸는 과도한 문장 재작성 금지",
    "반드시 JSON만 출력한다.",
    "출력 규칙:",
    "1) corrected: 전체 교정문",
    "2) issues: 실제 변경 항목만 배열",
    "3) issue 형식: wrong, correct, hint",
    "4) wrong/correct는 원문의 실제 조각 단위로 작성",
    "5) 교정이 필요 없으면 issues는 빈 배열",
  ].join("\n");

  const openaiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: prompt },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      text: {
        format: {
          type: "json_schema",
          name: "spell_report",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              corrected: { type: "string" },
              issues: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    wrong: { type: "string" },
                    correct: { type: "string" },
                    hint: { type: "string" },
                  },
                  required: ["wrong", "correct", "hint"],
                },
              },
            },
            required: ["corrected", "issues"],
          },
        },
      },
    }),
  });

  const data = await openaiRes.json();
  if (!openaiRes.ok) {
    json(res, 502, {
      error: "OpenAI request failed",
      detail: data?.error?.message || "unknown error",
    });
    return;
  }

  let parsed;
  const outputText = getResponseOutputText(data);
  try {
    parsed = JSON.parse(outputText || "{}");
  } catch {
    json(res, 502, {
      error: "OpenAI response parse failed",
      detail: "JSON 형식 응답을 해석하지 못했습니다.",
    });
    return;
  }

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues
        .filter((x) => x && typeof x.wrong === "string" && typeof x.correct === "string")
        .map((x) => ({
          wrong: x.wrong,
          correct: x.correct,
          hint: typeof x.hint === "string" ? x.hint : "교정 제안",
        }))
    : [];

  const correctedRaw = typeof parsed.corrected === "string" ? parsed.corrected : text;
  const corrected = normalizeWhitespaceForKorean(correctedRaw);
  const sanitizedIssues = sanitizeIssues(issues);
  const highlighted = buildHighlight(text, sanitizedIssues);

  const report = { corrected, issues: sanitizedIssues, highlighted, cached: false };
  setCachedSpell(cacheKey, report);
  json(res, 200, report);
}

function buildHighlight(original, issues) {
  if (!issues.length) {
    return escapeHtml(original);
  }

  let html = escapeHtml(original);
  const sorted = [...issues].sort((a, b) => b.wrong.length - a.wrong.length);

  sorted.forEach((issue) => {
    if (!issue.wrong) {
      return;
    }
    const pattern = escapeRegExp(escapeHtml(issue.wrong));
    html = html.replace(new RegExp(pattern, "g"), `<span class=\"mark\">${escapeHtml(issue.wrong)}</span>`);
  });

  return html;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function getCachedSpell(cacheKey) {
  const hit = spellCache.get(cacheKey);
  if (!hit) {
    return null;
  }
  if (Date.now() > hit.expiresAt) {
    spellCache.delete(cacheKey);
    return null;
  }
  return hit.value;
}

function setCachedSpell(cacheKey, report) {
  spellCache.set(cacheKey, {
    value: report,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function normalizeForCache(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function sanitizeIssues(issues) {
  const seen = new Set();
  const out = [];

  for (const item of issues) {
    const wrong = String(item.wrong || "").trim();
    const correct = String(item.correct || "").trim();
    const hint = String(item.hint || "교정 제안").trim() || "교정 제안";

    if (!wrong || !correct || wrong === correct) {
      continue;
    }

    const key = `${wrong}__${correct}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ wrong, correct, hint });
  }

  return out;
}

function normalizeWhitespaceForKorean(text) {
  return String(text).replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n").trim();
}

function getResponseOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (block?.type === "output_text" && typeof block?.text === "string") {
        return block.text;
      }
      if (block?.type === "text" && typeof block?.text === "string") {
        return block.text;
      }
    }
  }
  return "";
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadDotEnv(dotenvPath) {
  if (!fs.existsSync(dotenvPath)) {
    return;
  }

  const raw = fs.readFileSync(dotenvPath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const idx = trimmed.indexOf("=");
    if (idx < 1) {
      continue;
    }

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
