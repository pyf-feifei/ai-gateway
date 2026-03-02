// 模型定价表（每百万 token 的美元价格）
// 未命中的模型费用计为 $0
const MODEL_PRICING = {
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o1-pro': { input: 150.00, output: 600.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  // Claude
  'claude-opus-4': { input: 15.00, output: 75.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-3-7-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku': { input: 0.80, output: 4.00 },
  'claude-3-opus': { input: 15.00, output: 75.00 },
  'claude-3-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  // DeepSeek
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  // Google
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.0-pro': { input: 1.25, output: 10.00 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  // 国内模型
  'glm-4': { input: 1.00, output: 1.00 },
  'glm-4-flash': { input: 0.01, output: 0.01 },
  'glm-4-plus': { input: 0.50, output: 0.50 },
  'qwen-turbo': { input: 0.30, output: 0.60 },
  'qwen-plus': { input: 0.80, output: 2.00 },
  'qwen-max': { input: 2.00, output: 6.00 },
  'moonshot-v1-8k': { input: 1.00, output: 1.00 },
  'moonshot-v1-32k': { input: 2.00, output: 2.00 },
  'moonshot-v1-128k': { input: 6.00, output: 6.00 },
};

/**
 * 根据模型名和 token 数计算费用（美元）。
 * 优先精确匹配，其次前缀匹配。
 */
export function calculateCost(model, promptTokens, completionTokens) {
  if (!model) return 0;
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    for (const [key, value] of Object.entries(MODEL_PRICING)) {
      if (model.startsWith(key)) {
        pricing = value;
        break;
      }
    }
  }
  if (!pricing) return 0;
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}
