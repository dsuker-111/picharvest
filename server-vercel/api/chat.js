// 图仓 PicHarvest 官网 AI 代理 · 阿里云百炼（DashScope）
// ------------------------------------------------------------------
// Vercel Serverless Function，路由 /api/chat
//
// 环境变量（在 Vercel 项目 Settings → Environment Variables 配置）：
//   DASHSCOPE_API_KEY   必填，阿里云百炼 API Key
//   MODEL_NAME          可选，默认 deepseek-v4.1-flash
//   DASHSCOPE_BASE_URL  可选，默认 https://dashscope.aliyuncs.com/compatible-mode/v1
//
// 安全：API Key 只存在于服务端环境变量中，绝不出现在前端代码或响应里。

const BASE_URL = (
  process.env.DASHSCOPE_BASE_URL ||
  'https://dashscope.aliyuncs.com/compatible-mode/v1'
).replace(/\/+$/, '');

const MODEL_NAME = process.env.MODEL_NAME || 'deepseek-v4.1-flash';
const API_KEY = (process.env.DASHSCOPE_API_KEY || '').trim();

const SYSTEM_PROMPT = `你是「图仓 PicHarvest」官网的 AI 助手，服务对象是电商运营、设计师和选品人员。

关于图仓的准确事实（不要编造其他信息）：
- 图仓是一个 Chrome / Edge 浏览器扩展，Manifest V3，要求浏览器 116 以上版本。
- 用法：打开电商商品详情页 → 点击工具栏的图仓图标（或按 Alt+Shift+H）→ 扩展在本地扫描当前页面图片 → 自动去重、优先还原高清原图 → 勾选后一键打包 ZIP 或逐张下载。
- 支持平台：Amazon、Shopify（含自定义域名）、淘宝、天猫、1688、AliExpress、Alibaba、Shopee、eBay、Walmart、Etsy、Temu、SHEIN、京东、拼多多、小红书、抖音商城、TikTok Shop、Wish。未列出的电商页面走通用抓取。
- 核心能力：识别 CDN 尺寸后缀还原原图；合并同一张图的缩略图 / srcset / webp 变体；读取 img、srcset、JSON-LD、Open Graph、CSS 背景图、懒加载属性；ZIP 打包不转码不压缩画质；按商品标题自动命名文件夹。
- 隐私：没有账号系统、没有后端服务器、没有统计脚本。图片由浏览器直接从原 CDN 下载，不上传到任何服务器。唯一持久化的是扩展本地存储里的安装日期。
- 安装：下载 zip 解压 → 打开 chrome://extensions 或 edge://extensions → 开启右上角「开发者模式」→ 点「加载已解压的扩展程序」→ 选择解压后的文件夹。安装时出现「开发者模式扩展」提示是正常的，因为尚未上架应用商店。
- 版本 v1.0.0，安装包约 72 KB，MIT 许可，免费无需注册。
- 限制：部分 CDN 使用签名 URL、服务端裁切或严格防盗链，无法还原或拉取原图；ZIP 会跳过这些图片并提示，可以改用逐张下载（浏览器会带上页面登录态）。ZIP 单次最多 80 张，单张上限 40 MB，压缩包上限 280 MB；逐张下载单次最多 60 个任务。不处理视频文件，只提取视频封面图。

回答要求：
- 用中文，简洁直接，条理清晰，不要用夸张营销语气。
- 用户问安装、平台支持、失败排查、隐私这类问题，按上面的准确事实回答。
- 遇到不确定或超出范围的问题，明确说明不确定，不要编造功能。
- 不要声称图仓有服务器、账号、云端存储或视频下载能力。`;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Cache-Control', 'no-store');
}

function buildMessages(prompt, history) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  const items = Array.isArray(history) ? history.slice(-12) : [];
  for (const item of items) {
    const content = String((item && item.content) || '').trim();
    if (!content) continue;
    let role = item.role;
    if (role === 'ai' || role === 'assistant') role = 'assistant';
    else if (role === 'user') role = 'user';
    else continue;
    messages.push({ role, content: content.slice(0, 2000) });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      status: 'ok',
      provider: 'aliyun-dashscope',
      model: MODEL_NAME,
      key_configured: Boolean(API_KEY)
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ answer: '', error: '请求体不是合法 JSON' });
      return;
    }
  }
  body = body || {};

  const prompt = String(body.prompt || '').trim();
  if (!prompt) {
    res.status(200).json({ answer: '', model: MODEL_NAME });
    return;
  }

  if (!API_KEY) {
    res.status(200).json({
      answer: '',
      model: MODEL_NAME,
      error: '服务端未配置 DASHSCOPE_API_KEY'
    });
    return;
  }

  const payload = {
    model: MODEL_NAME,
    messages: buildMessages(prompt, body.history),
    max_tokens: Math.min(Number(body.max_tokens || body.max_new_tokens || 700), 1500),
    temperature: Number(body.temperature ?? 0.6),
    // deepseek 系列默认开启推理会消耗大量 reasoning token 且明显变慢；
    // 官网客服场景关闭思考，响应更快更直接。
    enable_thinking: false,
    stream: false
  };

  try {
    const upstream = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      res.status(200).json({
        answer: '',
        model: MODEL_NAME,
        error: '阿里云接口 HTTP ' + upstream.status + '：' + text.slice(0, 500)
      });
      return;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      res.status(200).json({ answer: '', model: MODEL_NAME, error: '阿里云返回非 JSON' });
      return;
    }

    const choice = (data.choices || [])[0] || {};
    const answer = String((choice.message || {}).content || '').trim();

    if (!answer) {
      res.status(200).json({
        answer: '',
        model: MODEL_NAME,
        error: '阿里云返回内容为空：' + text.slice(0, 300)
      });
      return;
    }

    res.status(200).json({ answer, model: MODEL_NAME });
  } catch (err) {
    res.status(200).json({
      answer: '',
      model: MODEL_NAME,
      error: '调用阿里云失败：' + (err && err.message ? err.message : String(err))
    });
  }
}
