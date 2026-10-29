// 图仓 PicHarvest 官网 AI 代理 · 健康检查
// 路由 /api/health，用于前端判断代理是否可用、Key 是否已配置。

const MODEL_NAME = process.env.MODEL_NAME || 'deepseek-v4.1-flash';
const API_KEY = (process.env.DASHSCOPE_API_KEY || '').trim();

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  res.status(200).json({
    status: 'ok',
    provider: 'aliyun-dashscope',
    model: MODEL_NAME,
    key_configured: Boolean(API_KEY)
  });
}
