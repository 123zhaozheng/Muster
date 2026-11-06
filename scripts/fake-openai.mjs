#!/usr/bin/env node
/**
 * 本地假 OpenAI 兼容服务：用来在没有真实 key 的情况下，演示 / 测试 Muster 的真实模型链路。
 *
 * 用法
 *   node scripts/fake-openai.mjs [--port 8787] [--key sk-xxx] [--models fake-chat,fake-2]
 *   然后在 Muster「设置 → 模型 → 添加服务商 → 自定义（OpenAI 兼容）」里填：
 *     Base URL  http://127.0.0.1:8787/v1
 *     API Key   任意（若启动时用了 --key 则必须一致）
 *     模型 ID   fake-chat
 *
 * 环境变量（命令行参数优先）
 *   FAKE_OPENAI_PORT    监听端口，默认 8787；0 = 随机端口
 *   FAKE_OPENAI_KEY     设置后要求 `Authorization: Bearer <key>`，否则 401
 *   FAKE_OPENAI_MODELS  逗号分隔的模型 ID，默认 fake-chat,fake-2；请求其他模型返回 404
 *
 * 端点：GET /v1/models，POST /v1/chat/completions（stream: true / false 都支持，流式带 usage）
 *
 * 行为（按请求里的 tools 判断是谁在调用）
 *   1. Pip 路由（tools 里有 dispatch 与 reply）：
 *        用户消息点名了成员名（取自 system 里的成员清单），或含「调研 / 查一下 / 研究 / 搜一下」等词
 *        -> 返回 dispatch 工具调用（点名优先；没点名则挑擅长含「调研/研究」的成员，再退到第一个成员）
 *        否则 -> 返回一段中文闲聊文本
 *   2. 原生成员（tools 里有 read / ls / grep / bash 等）：
 *        用户消息含「读一下 / 读取 / read 」时先返回一次 read 工具调用（演示工具链），
 *        拿到工具结果后再给最终回答；否则直接回答。回答里会带上 system 里的「你的名字是「X」」。
 *   3. 其他（如「测试连接」只回复 OK）：含 "OK" 要求则回 "OK"，否则回一句中文。
 *
 * 也可以当库用：import { startFakeOpenAI } from "./fake-openai.mjs"，
 *   const s = await startFakeOpenAI({ port: 0, apiKey: "sk-1" }); s.url / s.requests / await s.close()
 */
import http from "node:http";
import { fileURLToPath } from "node:url";

const text = (c) =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("") : "";

/** 从 Pip 的 system 提示里解析成员清单：`- id=..｜名字=..｜类型=..｜擅长=..｜…` */
function parseRoster(system) {
  const out = [];
  for (const line of system.split("\n")) {
    if (!line.startsWith("- id=")) continue;
    const f = Object.fromEntries(
      line
        .slice(2)
        .split("｜")
        .map((kv) => {
          const i = kv.indexOf("=");
          return i < 0 ? [kv, ""] : [kv.slice(0, i), kv.slice(i + 1)];
        }),
    );
    out.push({ id: f.id, name: f["名字"] ?? "", skills: f["擅长"] ?? "" });
  }
  return out;
}

const RESEARCH_WORDS = /调研|查一下|研究|搜一下|查查|查找|了解一下/;

/** 决定回复：{ text } | { toolCall: { name, args } } */
export function decide(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => text(m.content)).join("\n");
  const last = messages[messages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const user = lastUser ? text(lastUser.content) : "";
  const toolNames = new Set((body.tools ?? []).map((t) => t?.function?.name ?? t?.name));
  const model = body.model ?? "fake";

  // 1. Pip 路由
  if (toolNames.has("dispatch") && toolNames.has("reply")) {
    const roster = parseRoster(system);
    const named = roster.filter((r) => r.name && user.toLowerCase().includes(r.name.toLowerCase()));
    if (named.length || RESEARCH_WORDS.test(user)) {
      const target =
        named[0] ?? roster.find((r) => /调研|研究|research/i.test(r.skills)) ?? roster[0];
      if (target) {
        return {
          text: `好的，这件事交给 ${target.name}。`,
          toolCall: {
            name: "dispatch",
            args: { tasks: [{ botId: target.id, title: user.replace(/\s+/g, " ").slice(0, 14) || "新任务", prompt: user }] },
          },
        };
      }
      return { toolCall: { name: "reply", args: { text: "团队里还没有合适的成员，先去「团队」页添加一位吧。" } } };
    }
    return { text: `我是 Pip（${model}）。这句我先当闲聊接住了；需要动手的事，告诉我交给谁，或者说「帮我调研一下……」。` };
  }

  // 2. 原生成员（带 pi-durable 的文件 / 命令工具）
  if (toolNames.has("read") || toolNames.has("ls") || toolNames.has("grep") || toolNames.has("bash")) {
    const who = /你的名字是「([^」]+)」/.exec(system)?.[1] ?? "原生成员";
    const afterTool = last?.role === "tool";
    if (!afterTool && toolNames.has("read") && /读一下|读取|read /i.test(user)) {
      const path = /([\w./\\-]+\.(?:md|txt|json|ts|js|mjs))/i.exec(user)?.[1] ?? "README.md";
      return { text: `我先看一下 ${path}。`, toolCall: { name: "read", args: { path } } };
    }
    if (afterTool) {
      const got = text(last.content).replace(/\s+/g, " ").slice(0, 60);
      return { text: `${who}：文件我读过了（${got || "空内容"}）。结论已整理好，如需细化请继续告诉我。` };
    }
    return {
      text:
        `${who}：收到。关于「${user.replace(/\s+/g, " ").slice(0, 40)}」，我的调研结论如下：\n\n` +
        `1. 背景：这是由假 OpenAI 服务（${model}）生成的演示回答，用来验证链路。\n` +
        `2. 要点：流式输出、人设、用量统计都已走通。\n` +
        `3. 下一步：换成真实模型的 Base URL 与 Key 即可。`,
    };
  }

  // 3. 其他
  if (/OK/.test(user)) return { text: "OK" };
  return { text: `（${model}）收到：${user.slice(0, 60)}` };
}

const approxTokens = (s) => Math.max(1, Math.ceil(s.length / 2));

export async function startFakeOpenAI(opts = {}) {
  const modelIds = new Set(opts.models ?? (process.env.FAKE_OPENAI_MODELS ?? "fake-chat,fake-2").split(",").map((s) => s.trim()).filter(Boolean));
  const apiKey = opts.apiKey ?? process.env.FAKE_OPENAI_KEY ?? "";
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const json = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const err = (code, message, errType, errCode) => json(code, { error: { message, type: errType, code: errCode ?? null } });

    if (apiKey && req.headers.authorization !== `Bearer ${apiKey}`) {
      return err(401, "Incorrect API key provided.", "invalid_request_error", "invalid_api_key");
    }
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/v1/models") {
      return json(200, { object: "list", data: [...modelIds].map((id) => ({ id, object: "model", created: 1, owned_by: "fake-openai" })) });
    }
    if (req.method !== "POST" || path !== "/v1/chat/completions") return err(404, `Not found: ${req.method} ${path}`, "invalid_request_error", "not_found");

    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return err(400, "invalid JSON body", "invalid_request_error");
    }
    requests.push({ auth: req.headers.authorization, body });
    if (!modelIds.has(body.model)) {
      return err(404, `The model \`${body.model}\` does not exist`, "invalid_request_error", "model_not_found");
    }

    const d = decide(body);
    const base = { id: "chatcmpl-fake", created: Math.floor(Date.now() / 1000), model: body.model };
    const argsJson = d.toolCall ? JSON.stringify(d.toolCall.args) : "";
    const toolCalls = d.toolCall
      ? [{ id: "call_fake_1", type: "function", function: { name: d.toolCall.name, arguments: argsJson } }]
      : undefined;
    const promptTokens = approxTokens(JSON.stringify(body.messages ?? []));
    const completionTokens = approxTokens((d.text ?? "") + argsJson);
    const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
    const finish = toolCalls ? "tool_calls" : "stop";

    if (!body.stream) {
      return json(200, {
        ...base,
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: d.text ?? null, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: finish }],
        usage,
      });
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (data) => res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
    const chunk = (delta, finish_reason = null) => send({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    chunk({ role: "assistant", content: "" });
    for (const piece of (d.text ?? "").match(/[\s\S]{1,4}/g) ?? []) {
      chunk({ content: piece });
      await sleep(5);
    }
    if (toolCalls) {
      chunk({ tool_calls: [{ index: 0, id: "call_fake_1", type: "function", function: { name: d.toolCall.name, arguments: "" } }] });
      for (const piece of argsJson.match(/[\s\S]{1,12}/g) ?? []) {
        chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] });
        await sleep(2);
      }
    }
    chunk({}, finish);
    send({ ...base, object: "chat.completion.chunk", choices: [], usage });
    send("[DONE]");
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    port,
    url: `http://${opts.host ?? "127.0.0.1"}:${port}/v1`,
    requests,
    async close() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
    },
  };
}

// 直接运行：node scripts/fake-openai.mjs [--port N] [--key K] [--models a,b]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const port = Number(arg("port") ?? process.env.FAKE_OPENAI_PORT ?? 8787);
  const models = arg("models")?.split(",").map((s) => s.trim()).filter(Boolean);
  const s = await startFakeOpenAI({ port, apiKey: arg("key"), models });
  console.log(`[fake-openai] listening on ${s.url}  (key: ${arg("key") ?? process.env.FAKE_OPENAI_KEY ?? "不校验"})`);
  const stop = () => s.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
