#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const DATASET_PATH = process.env.SPELL_EVAL_DATASET || path.join(process.cwd(), "eval-data", "spell_eval_sample.jsonl");
const MODEL_LIST = (process.env.SPELL_EVAL_MODELS || "gpt-4.1-mini,gpt-4.1-nano")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const MAX_SAMPLES = Number(process.env.SPELL_EVAL_MAX_SAMPLES || 0);
const TEMPERATURE = Number(process.env.SPELL_EVAL_TEMPERATURE || 0.1);

const MODEL_PRICING_PER_M = {
  "gpt-4.1": { in: 2.0, out: 8.0 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
};

function loadDataset(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return lines.map((line, idx) => {
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${idx + 1}: ${error.message}`);
    }

    const source = String(row.source || "");
    const target = String(row.target || "");
    if (!source || !target) {
      throw new Error(`Line ${idx + 1} must include source and target`);
    }

    return {
      id: String(row.id || idx + 1),
      source,
      target,
      category: String(row.category || "general"),
    };
  });
}

function levenshtein(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  const dp = Array.from({ length: x.length + 1 }, () => Array(y.length + 1).fill(0));

  for (let i = 0; i <= x.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= y.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[x.length][y.length];
}

function normalizeWhitespaceForKorean(text) {
  return String(text).replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n").trim();
}

function extractOutputText(data) {
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

async function runModel(model, dataset) {
  const results = [];
  const startedAt = Date.now();

  for (const row of dataset) {
    const prompt = [
      "너는 한국어 교정 전문가다.",
      "다음 문장을 맞춤법, 띄어쓰기, 문법 기준으로 교정한다.",
      "의미를 바꾸는 과도한 재작성은 금지한다.",
      "반드시 JSON만 출력한다.",
      "형식: {\"corrected\":\"...\"}",
    ].join("\n");

    const t0 = Date.now();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: prompt },
          { role: "user", content: row.source },
        ],
        temperature: TEMPERATURE,
        text: {
          format: {
            type: "json_schema",
            name: "spell_eval",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                corrected: { type: "string" },
              },
              required: ["corrected"],
            },
          },
        },
      }),
    });

    const latencyMs = Date.now() - t0;
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Model ${model} failed on sample ${row.id}: ${body?.error?.message || "unknown error"}`);
    }

    let corrected = row.source;
    try {
      const parsed = JSON.parse(extractOutputText(body) || "{}");
      corrected = normalizeWhitespaceForKorean(parsed.corrected || row.source);
    } catch {
      corrected = row.source;
    }

    const dSource = levenshtein(row.source, row.target);
    const dModel = levenshtein(corrected, row.target);
    const usage = body?.usage || {};

    results.push({
      id: row.id,
      category: row.category,
      source: row.source,
      target: row.target,
      output: corrected,
      exact: corrected === row.target,
      improved: dModel < dSource,
      regressed: dModel > dSource,
      unchanged: corrected === row.source,
      isClean: row.source === row.target,
      overcorrected: row.source === row.target && corrected !== row.source,
      cer: dModel / Math.max(1, Array.from(row.target).length),
      latencyMs,
      inputTokens: Number(usage.input_tokens || 0),
      outputTokens: Number(usage.output_tokens || 0),
      totalTokens: Number(usage.total_tokens || 0),
    });
  }

  const elapsedMs = Date.now() - startedAt;
  return summarize(model, results, elapsedMs);
}

function summarize(model, rows, elapsedMs) {
  const n = rows.length;
  const clean = rows.filter((x) => x.isClean);
  const dirty = rows.filter((x) => !x.isClean);

  const sum = (selector, arr = rows) => arr.reduce((acc, cur) => acc + selector(cur), 0);
  const ratio = (selector, arr = rows) => (arr.length ? sum((x) => (selector(x) ? 1 : 0), arr) / arr.length : 0);

  const inputTokens = sum((x) => x.inputTokens);
  const outputTokens = sum((x) => x.outputTokens);
  const pricing = MODEL_PRICING_PER_M[model];
  const estimatedUsd = pricing
    ? (inputTokens / 1_000_000) * pricing.in + (outputTokens / 1_000_000) * pricing.out
    : null;

  return {
    model,
    sampleCount: n,
    exactMatchRate: ratio((x) => x.exact),
    improveRate: ratio((x) => x.improved),
    regressRate: ratio((x) => x.regressed),
    meanCER: sum((x) => x.cer) / Math.max(1, n),
    overcorrectionRate: ratio((x) => x.overcorrected, clean),
    noChangeOnCleanRate: ratio((x) => x.unchanged, clean),
    fixRateOnDirty: ratio((x) => x.exact, dirty),
    p50LatencyMs: percentile(rows.map((x) => x.latencyMs), 50),
    p95LatencyMs: percentile(rows.map((x) => x.latencyMs), 95),
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    estimatedCostUsd: estimatedUsd,
    elapsedMs,
    results: rows,
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function formatPercent(x) {
  return `${(x * 100).toFixed(2)}%`;
}

function pickWinner(summaries) {
  const sorted = [...summaries].sort((a, b) => {
    if (b.exactMatchRate !== a.exactMatchRate) return b.exactMatchRate - a.exactMatchRate;
    if (a.overcorrectionRate !== b.overcorrectionRate) return a.overcorrectionRate - b.overcorrectionRate;
    if ((a.estimatedCostUsd || Number.POSITIVE_INFINITY) !== (b.estimatedCostUsd || Number.POSITIVE_INFINITY)) {
      return (a.estimatedCostUsd || Number.POSITIVE_INFINITY) - (b.estimatedCostUsd || Number.POSITIVE_INFINITY);
    }
    return a.p95LatencyMs - b.p95LatencyMs;
  });
  return sorted[0];
}

async function main() {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }
  if (!MODEL_LIST.length) {
    throw new Error("SPELL_EVAL_MODELS is empty");
  }

  const datasetAll = loadDataset(DATASET_PATH);
  const dataset = MAX_SAMPLES > 0 ? datasetAll.slice(0, MAX_SAMPLES) : datasetAll;
  if (!dataset.length) {
    throw new Error("Dataset is empty");
  }

  const summaries = [];
  for (const model of MODEL_LIST) {
    console.log(`\n[eval] running model=${model} on ${dataset.length} samples...`);
    summaries.push(await runModel(model, dataset));
  }

  console.log("\n=== Spell Check A/B Summary ===");
  for (const s of summaries) {
    console.log(
      [
        `model=${s.model}`,
        `exact=${formatPercent(s.exactMatchRate)}`,
        `improve=${formatPercent(s.improveRate)}`,
        `regress=${formatPercent(s.regressRate)}`,
        `meanCER=${s.meanCER.toFixed(4)}`,
        `overcorrect=${formatPercent(s.overcorrectionRate)}`,
        `fixOnDirty=${formatPercent(s.fixRateOnDirty)}`,
        `latency(p50/p95)=${s.p50LatencyMs}ms/${s.p95LatencyMs}ms`,
        `tokens(in/out)=${s.totalInputTokens}/${s.totalOutputTokens}`,
        `estCost=${s.estimatedCostUsd == null ? "n/a" : `$${s.estimatedCostUsd.toFixed(6)}`}`,
      ].join(" | ")
    );
  }

  const winner = pickWinner(summaries);
  console.log(`\nRecommended winner by score: ${winner.model}`);

  const outDir = path.join(process.cwd(), "eval-data");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `spell_eval_result_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2));
  console.log(`Saved detailed results to ${outPath}`);
}

main().catch((error) => {
  console.error("[eval] failed:", error.message);
  process.exit(1);
});
