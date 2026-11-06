// model.test 的错误翻译：把 SDK / 网络错误变成用户看得懂的中文，并脱敏。

/** 把已知密钥与常见 key 形态替换为 ***。 */
export function redact(text: string, secrets: Array<string | undefined> = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("***");
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***")
    .replace(/\b(sk|key|tok)-[A-Za-z0-9._-]{8,}/g, "$1-***");
}

/** 把底层错误文本归类为友好提示；未识别时保留（脱敏、截断后的）原文。 */
export function friendlyError(raw: string, ctx: { baseUrl?: string; modelId: string; secrets?: Array<string | undefined> }): string {
  const msg = redact(raw, ctx.secrets).trim();
  const where = ctx.baseUrl ? `（${ctx.baseUrl}）` : "";
  if (/\b401\b|unauthori[sz]ed|invalid[_ ]?(api[_ ]?)?key|incorrect api key|authentication/i.test(msg)) return "API Key 无效或已过期（401），请检查密钥是否填对、是否属于该服务商";
  if (/\b403\b|forbidden|permission/i.test(msg)) return "没有权限访问该模型（403）：请确认账号已开通此模型或余额充足";
  if (/\b404\b|model[^.]{0,40}(not found|does not exist|not exist)|no such model|unknown model/i.test(msg))
    return `模型 "${ctx.modelId}" 不存在（404）：请检查模型 ID 拼写；自定义端点通常要求 baseUrl 以 /v1 结尾`;
  if (/\b429\b|rate.?limit|quota|insufficient/i.test(msg)) return "请求被限流或额度不足（429），请稍后再试或检查账户余额";
  if (/timed? ?out|timeout|aborted/i.test(msg)) return `请求超时：模型没有在时限内响应${where}`;
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|fetch failed|connection error|network|socket|certificate|ssl/i.test(msg))
    return `连不上 baseUrl${where}：请检查地址、网络、代理，或本地服务是否已启动`;
  if (/\b5\d\d\b/.test(msg)) return `服务商返回了服务端错误：${msg.slice(0, 200)}`;
  return msg.slice(0, 300) || "未知错误";
}
