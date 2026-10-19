import { config } from './config.js';
import { prepareImageForRecognition } from './media.js';
import {
  buildRecognitionPrompt,
  parseRecognitionContent,
  RecognitionParseError,
} from './recognition-utils.js';

export class RecognitionNotConfiguredError extends Error {}

export class RecognitionUpstreamError extends Error {
  constructor(message, { httpStatus = 502, publicMessage = '' } = {}) {
    super(message);
    this.name = 'RecognitionUpstreamError';
    this.httpStatus = httpStatus;
    this.publicMessage = publicMessage;
  }
}

export function recognitionConfigured() {
  return Boolean(config.deepseek.apiKey);
}

function responseContent(message) {
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
  }
  return '';
}

function providerLogDetail(body) {
  const message = body?.error?.message || body?.message || body?.error?.code || '';
  return String(message).replace(/\s+/g, ' ').slice(0, 240);
}

export async function recognizeIdCardImage(imageBuffer, side) {
  if (!recognitionConfigured()) {
    throw new RecognitionNotConfiguredError('DEEPSEEK_API_KEY 未配置');
  }

  let preparedImage;
  try {
    preparedImage = await prepareImageForRecognition(imageBuffer);
  } catch {
    throw new RecognitionUpstreamError('证件图片预处理失败', {
      httpStatus: 422,
      publicMessage: '证件图片处理失败，请更换清晰照片或手动填写。',
    });
  }

  const imageBase64 = preparedImage.toString('base64');
  const { system, userText } = buildRecognitionPrompt(side);
  const requestBody = {
    model: config.deepseek.model,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 1000,
    stream: false,
  };

  let response;
  try {
    response = await fetch(config.deepseek.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.deepseek.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(config.deepseek.timeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new RecognitionUpstreamError('DeepSeek 识别请求超时', {
        httpStatus: 504,
        publicMessage: '识别服务响应超时，请重试或手动填写信息。',
      });
    }
    console.error('DeepSeek 识别网络异常：', error.message);
    throw new RecognitionUpstreamError('DeepSeek 识别网络异常', {
      httpStatus: 502,
      publicMessage: '识别服务暂时不可用，请手动填写信息。',
    });
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok) {
    console.error(
      `DeepSeek 识别请求失败：HTTP ${response.status} ${providerLogDetail(result)}`.trim(),
    );
    if (response.status === 429) {
      throw new RecognitionUpstreamError('DeepSeek 识别请求被限流', {
        httpStatus: 503,
        publicMessage: '识别请求较多，请稍后重试或手动填写信息。',
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw new RecognitionUpstreamError('DeepSeek 识别鉴权失败', {
        httpStatus: 503,
        publicMessage: '识别服务配置异常，请联系管理员或手动填写信息。',
      });
    }
    throw new RecognitionUpstreamError(`DeepSeek 识别返回 HTTP ${response.status}`, {
      httpStatus: 502,
      publicMessage: '识别服务暂时不可用，请手动填写信息。',
    });
  }

  const content = responseContent(result?.choices?.[0]?.message);
  if (!content) {
    throw new RecognitionUpstreamError('DeepSeek 返回空内容', {
      httpStatus: 502,
      publicMessage: '未能返回有效识别结果，请重试或手动填写信息。',
    });
  }

  try {
    const parsed = parseRecognitionContent(content, side);
    return {
      provider: 'deepseek',
      model: config.deepseek.model,
      confidence: parsed.confidence,
      fields: parsed.fields,
      warnings: parsed.warnings,
    };
  } catch (error) {
    if (error instanceof RecognitionParseError) {
      throw new RecognitionUpstreamError('DeepSeek 返回的 JSON 无法解析', {
        httpStatus: 502,
        publicMessage: '识别结果无法解析，请重试或手动填写信息。',
      });
    }
    throw error;
  }
}
