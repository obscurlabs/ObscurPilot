import {
  createGroqClient,
  createSdkReasoningTransport,
  createSdkTranscriptionTransport,
  GroqReasoningAdapter,
  GroqTranscriptionAdapter,
} from '@obscurpilot/adapters-groq/boundary';
import { config as loadEnvironment } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

loadEnvironment({ path: resolve('.env'), override: false, quiet: true });

const wavPath = process.argv[2];
const apiKey = process.env.GROQ_API_KEY;
if (apiKey === undefined || apiKey.trim() === '' || wavPath === undefined) {
  process.stdout.write(JSON.stringify({ configured: false, stt: false, reasoning: false }) + '\n');
  process.exitCode = 2;
} else {
  const controller = new globalThis.AbortController();
  const client = createGroqClient({ apiKey, timeoutMs: 20_000 });
  const bytes = new Uint8Array(await readFile(resolve(wavPath)));
  const transcription = new GroqTranscriptionAdapter({
    model: 'whisper-large-v3-turbo',
    transport: createSdkTranscriptionTransport(client),
    maxAttempts: 2,
  });
  const primaryModel = process.env.GROQ_REASONING_MODEL ?? 'openai/gpt-oss-120b';
  const fallbackModel = process.env.GROQ_REASONING_FALLBACK_MODEL;
  const models = [primaryModel, fallbackModel].filter(
    (model, index, values) => model !== undefined && values.indexOf(model) === index,
  );
  const result = { configured: true, stt: false, reasoning: [] };

  try {
    const stt = await transcription.transcribe(
      {
        clipId: randomUUID(),
        sessionId: randomUUID(),
        durationMs: 2_000,
        bytes,
        mimeType: 'audio/wav',
        truncated: false,
      },
      randomUUID(),
      controller.signal,
    );
    result.stt = stt.text.length > 0;

    for (const model of models) {
      const startedAt = performance.now();
      let responseShape;
      try {
        const sdkTransport = createSdkReasoningTransport(client);
        const reasoning = new GroqReasoningAdapter({
          primaryModel: model,
          maxAttempts: 1,
          transport: {
            complete: async (input) => {
              const response = await sdkTransport.complete(input);
              const choice = response?.choices?.[0];
              const message = choice?.message;
              const toolCall = message?.tool_calls?.[0];
              responseShape = {
                choices: Array.isArray(response?.choices) ? response.choices.length : -1,
                finishReason: choice?.finish_reason,
                role: message?.role,
                contentType: message?.content === null ? 'null' : typeof message?.content,
                toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls.length : -1,
                toolCallKeys:
                  toolCall === undefined ? [] : Object.keys(toolCall).sort().slice(0, 8),
                functionKeys:
                  toolCall?.function === undefined
                    ? []
                    : Object.keys(toolCall.function).sort().slice(0, 8),
                argumentsType: typeof toolCall?.function?.arguments,
              };
              return response;
            },
          },
          timeoutMs: 20_000,
        });
        const turn = await reasoning.complete(
          [
            {
              role: 'system',
              content:
                'Call fixture_status_v1 exactly once for this request. Do not invent arguments.',
            },
            { role: 'user', content: 'Use the status tool now.' },
          ],
          [
            {
              type: 'function',
              function: {
                name: 'fixture_status_v1',
                description: 'Read the safe status acceptance fixture.',
                parameters: { type: 'object', properties: {}, additionalProperties: false },
              },
            },
          ],
          randomUUID(),
          controller.signal,
        );
        result.reasoning.push({
          model,
          accepted: turn.toolCalls.length === 1 && turn.toolCalls[0]?.name === 'fixture_status_v1',
          durationMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        const reasonCode =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : 'UNKNOWN';
        result.reasoning.push({
          model,
          accepted: false,
          durationMs: -1,
          reasonCode,
          responseShape,
        });
      }
    }
  } catch {
    result.stt = false;
  } finally {
    bytes.fill(0);
  }

  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.stt || result.reasoning.some(({ accepted }) => !accepted)) process.exitCode = 1;
}
