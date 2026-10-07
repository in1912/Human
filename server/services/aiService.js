// Vivix Human — 文字对话模型（LLM）最小实现
// 数字人「未开实时对话时的文字试聊」由它承担（实时对话走 Vivix，不经这里）。
// 配置存租户库 settings 键 `llm`：{ base_url, api_key, model }（OpenAI 兼容 /chat/completions）。
// GET/PUT /llm/config 由路由层暴露；api_key 只写不回读（回 has_key）。
'use strict';
const { getSetting, setSetting } = require('../db');

// 地址归一：无路径的 base（IP:端口 或 域名）自动补 /v1；容忍尾斜杠；整条接口地址粘进来不双拼
function chatEndpoint(base) {
  let b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  if (/\/(v1\/)?chat\/completions$/.test(b)) return b;
  if (/\/v1$/.test(b)) return b + '/chat/completions';
  return b.replace(/^((?:https?:\/\/)?[^/]+)$/i, '$1/v1') + '/chat/completions';
}

function llmConfig(tdb) {
  const d = tdb || null;
  const cfg = d ? getSetting(d, 'llm', {}) : getSetting('llm', {});
  return {
    base_url: String(cfg.base_url || '').trim(),
    api_key: String(cfg.api_key || '').trim(),
    model: String(cfg.model || '').trim(),
  };
}

function saveLlmConfig(tdb, patch) {
  const cur = llmConfig(tdb);
  const next = {
    base_url: patch.base_url !== undefined ? String(patch.base_url || '').trim() : cur.base_url,
    // api_key 留空 = 保持原值（不回显，前端只见 has_key）
    api_key: (patch.api_key !== undefined && String(patch.api_key || '').trim()) ? String(patch.api_key).trim() : cur.api_key,
    model: patch.model !== undefined ? String(patch.model || '').trim() : cur.model,
  };
  if (tdb) setSetting(tdb, 'llm', next); else setSetting('llm', next);
  return next;
}

function publicLlmConfig(tdb) {
  const c = llmConfig(tdb);
  return { base_url: c.base_url, model: c.model, has_key: !!c.api_key };
}

const TIMEOUT_MS = 150000;

// msgs: [{role, content}]; opts: {maxTokens, temperature, tdb}
async function chatEx(msgs, opts = {}) {
  const cfg = llmConfig(opts.tdb);
  if (!cfg.base_url || !cfg.api_key || !cfg.model) {
    const err = new Error('尚未配置文字对话模型——到「设置 → 文字对话模型」填写 Base 地址、API Key 与模型名并保存');
    err.status = 400;
    throw err;
  }
  const url = chatEndpoint(cfg.base_url);
  const body = JSON.stringify({
    model: cfg.model,
    messages: msgs,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.8,
  });
  const call = () => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let resp;
  try {
    resp = await call();
    // 网络类失败（超时/5xx/限流）重试一次，隔 1.5s
    if (resp.status === 408 || resp.status === 429 || resp.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500));
      resp = await call();
    }
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      const err = new Error(`请求文字对话模型超时（${Math.round(TIMEOUT_MS / 1000)}s）`);
      err.status = 504;
      throw err;
    }
    await new Promise((r) => setTimeout(r, 1500));
    try { resp = await call(); } catch (e2) { throw new Error(`连不上文字对话模型：${e2.message}`); }
  }

  const text = await resp.text();
  if (!resp.ok) throw new Error(`文字对话模型返回 ${resp.status}：${text.slice(0, 300)}`);
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('文字对话模型返回的不是合法 JSON'); }
  const msg = j.choices?.[0]?.message || {};
  // 推理模型偶发 content 空、内容在 reasoning_content
  const content = msg.content || msg.reasoning_content || '';
  if (!String(content).trim()) throw new Error('AI 返回内容为空，请重试一次');
  return {
    content: String(content),
    model: j.model || cfg.model,
    usage: j.usage || null,
    finish_reason: j.choices?.[0]?.finish_reason || null,
  };
}

module.exports = { chatEndpoint, llmConfig, saveLlmConfig, publicLlmConfig, chatEx };
