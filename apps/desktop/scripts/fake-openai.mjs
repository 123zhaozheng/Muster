// 最小的假 OpenAI 兼容服务，用于联调（不联网、不花钱）。
//   node fake-openai.mjs [--port 0] [--key sk-fake-muster-key]
// 端点：GET /v1/models、POST /v1/chat/completions（流式 SSE 与非流式）、GET /__stats（请求统计）。
// 行为：
//   - 校验 Authorization: Bearer <key>（--key 为空串则不校验）。
//   - 请求带 dispatch 工具（Pip 路由）时：从系统提示的成员清单里找出被点名的成员，返回 dispatch 工具调用。
//   - 其他请求（原生成员、model.test）：返回一段固定的中文回复，并回显用户最后一句话。
import { createServer } from "node:http";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const PORT = Number(arg("port", process.env.FAKE_OPENAI_PORT ?? "0"));
const KEY = arg("key", process.env.FAKE_OPENAI_KEY ?? "sk-fake-muster-key");
const MODELS = ["fake-chat", "fake-pro"];

const stats = { total: 0, chat: 0, dispatch: 0, unauthorized: 0, models: {}, lastUserText: "" };

const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p?.text ?? "").join("") : "";

/** 成员清单行：- id=bot-x｜名字=小码｜... */
function parseRoster(system) {
  const out = [];
  for (const line of system.split("\n")) {
    const m = /^- id=([^｜]+)｜名字=([^｜]+)/.exec(line);
    if (m) out.push({ id: m[1], name: m[2] });
  }
  return out;
}

/** 把「交给小码修 xx，交给阿克写 yy」拆成若干任务。 */
function planDispatch(messages) {
  const system = messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => textOf(m.content)).join("\n");
  const user = [...messages].reverse().find((m) => m.role === "user");
  const text = user ? textOf(user.content) : "";
  const roster = parseRoster(system);
  const tasks = [];
  for (const seg of text.split(/[，,；;。\n]+/)) {
    const bot = roster.find((b) => seg.includes(b.name));
    if (!bot) continue;
    const prompt = seg.replace(/^.*?(交给|让|请|找)/, "").replace(bot.name, "").trim() || seg.trim();
    tasks.push({ botId: bot.id, title: prompt.slice(0, 24), prompt });
  }
  return tasks;
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const json = (status, obj) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  stats.total++;
  if (req.url === "/__stats") return json(200, stats);
  if (KEY && req.headers.authorization !== `Bearer ${KEY}`) {
    stats.unauthorized++;
    return json(401, { error: { message: "Incorrect API key provided.", type: "invalid_request_error" } });
  }
  if (req.method === "GET" && req.url === "/v1/models") {
    return json(200, { object: "list", data: MODELS.map((id) => ({ id, object: "model", created: 1, owned_by: "fake" })) });
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") return json(404, { error: { message: "not found" } });

  const body = await readBody(req);
  if (!MODELS.includes(body.model)) {
    return json(404, { error: { message: `The model \`${body.model}\` does not exist`, code: "model_not_found" } });
  }
  stats.chat++;
  stats.models[body.model] = (stats.models[body.model] ?? 0) + 1;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  stats.lastUserText = lastUser ? textOf(lastUser.content).slice(0, 200) : "";

  const hasDispatch = (body.tools ?? []).some((t) => t?.function?.name === "dispatch");
  const tasks = hasDispatch ? planDispatch(messages) : [];
  const base = { id: "chatcmpl-fake", created: Math.floor(Date.now() / 1000), model: body.model };
  const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };

  let content = "";
  let toolCalls = null;
  if (tasks.length) {
    stats.dispatch++;
    content = `好的，我来安排：${tasks.length} 项任务已分头派出。`;
    toolCalls = [{ id: "call_fake_1", type: "function", function: { name: "dispatch", arguments: JSON.stringify({ tasks }) } }];
  } else if (hasDispatch) {
    content = "我是 Pip（假模型）。想让成员动手的话，可以说「交给小码修 xx」。";
  } else if (/只回复\s*OK|reply\s*OK/i.test(stats.lastUserText)) {
    content = "OK";
  } else {
    const ask = stats.lastUserText.replace(/\s+/g, " ").slice(0, 60);
    content = `【假模型回复】已收到：「${ask}」。这是联调用的固定回答，任务完成。`;
  }

  if (!body.stream) {
    return json(200, {
      ...base,
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? "tool_calls" : "stop" }],
      usage,
    });
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finish = null) =>
    `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  res.write(chunk({ role: "assistant", content: "" }));
  const chars = [...content];
  for (let i = 0; i < chars.length; i += 4) {
    res.write(chunk({ content: chars.slice(i, i + 4).join("") }));
    await new Promise((r) => setTimeout(r, 25));
  }
  if (toolCalls) {
    const tc = toolCalls[0];
    res.write(chunk({ tool_calls: [{ index: 0, id: tc.id, type: "function", function: { name: tc.function.name, arguments: "" } }] }));
    res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: tc.function.arguments } }] }));
  }
  res.write(chunk({}, toolCalls ? "tool_calls" : "stop"));
  res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [], usage })}\n\n`);
  res.end("data: [DONE]\n\n");
});

server.listen(PORT, "127.0.0.1", () => {
  const { port } = server.address();
  console.log(`LISTENING ${port} key=${KEY || "(none)"}`);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
