/**
 * OpenAI Responses API <-> Chat Completions format adapter.
 *
 * Based on HuggingFace responses.js (MIT) conversion logic, adapted for Cloudflare Workers.
 *
 * Request:  Responses API -> Chat Completions  (responsesToChatCompletions)
 * Response: Chat Completions -> Responses API  (chatCompletionsToResponses / chatCompletionsStreamToResponsesStream)
 */

// ─── Request conversion ────────────────────────────────────────────

/**
 * Convert a Responses API request body to Chat Completions format.
 */
export function responsesToChatCompletions(body) {
  const messages = [];

  if (body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }

  if (typeof body.input === 'string') {
    messages.push({ role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      const converted = convertInputItem(item);
      if (converted) {
        if (Array.isArray(converted)) messages.push(...converted);
        else messages.push(converted);
      }
    }
  }

  const result = {
    model: body.model,
    messages,
    stream: body.stream || false,
  };

  if (body.max_output_tokens !== undefined && body.max_output_tokens !== null) {
    result.max_tokens = body.max_output_tokens;
  }
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;

  if (body.tools?.length > 0) {
    result.tools = [];
    for (const tool of body.tools) {
      if (tool.type === 'function') {
        result.tools.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.parameters || {},
            ...(tool.strict !== undefined && { strict: tool.strict }),
          },
        });
      }
    }
    if (result.tools.length === 0) delete result.tools;
  }

  if (body.tool_choice !== undefined) {
    if (typeof body.tool_choice === 'string') {
      result.tool_choice = body.tool_choice;
    } else if (body.tool_choice?.name) {
      result.tool_choice = { type: 'function', function: { name: body.tool_choice.name } };
    }
  }

  if (body.text?.format) {
    const fmt = body.text.format;
    if (fmt.type === 'json_schema') {
      result.response_format = {
        type: 'json_schema',
        json_schema: {
          name: fmt.name,
          description: fmt.description,
          schema: fmt.schema,
          strict: fmt.strict || false,
        },
      };
    } else if (fmt.type === 'json_object') {
      result.response_format = { type: 'json_object' };
    }
  }

  if (body.reasoning?.effort) {
    result.reasoning_effort = body.reasoning.effort;
  }

  return result;
}

function convertInputItem(item) {
  const type = item.type || 'message';

  switch (type) {
    case 'message': {
      if (!item.role) return null;
      let content;
      if (typeof item.content === 'string') {
        content = item.content;
      } else if (Array.isArray(item.content)) {
        const parts = [];
        for (const part of item.content) {
          switch (part.type) {
            case 'input_text':
              parts.push({ type: 'text', text: part.text });
              break;
            case 'output_text':
              if (part.text) parts.push({ type: 'text', text: part.text });
              break;
            case 'input_image':
              parts.push({ type: 'image_url', image_url: { url: part.image_url } });
              break;
          }
        }
        content = parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
      }
      if (!content || (Array.isArray(content) && content.length === 0)) return null;
      const role = item.role === 'developer' ? 'system' : item.role;
      return { role, content };
    }

    case 'function_call':
      return {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: item.call_id,
          type: 'function',
          function: { name: item.name, arguments: item.arguments },
        }],
      };

    case 'function_call_output':
      return {
        role: 'tool',
        tool_call_id: item.call_id,
        content: item.output,
      };

    default:
      return null;
  }
}

// ─── Non-streaming response conversion ─────────────────────────────

/**
 * Convert a Chat Completions JSON response to Responses API format.
 */
export function chatCompletionsToResponses(openaiData, model) {
  const response = {
    id: 'resp_' + rid(),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: model || openaiData.model || 'unknown',
    output: [],
    usage: {
      input_tokens: openaiData.usage?.prompt_tokens || 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: openaiData.usage?.completion_tokens || 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: (openaiData.usage?.prompt_tokens || 0) + (openaiData.usage?.completion_tokens || 0),
    },
    error: null,
  };

  if (openaiData.choices?.length > 0) {
    const choice = openaiData.choices[0];
    const message = choice.message;

    if (message.content) {
      response.output.push({
        id: 'msg_' + rid(),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: message.content, annotations: [] }],
      });
    }

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        response.output.push({
          type: 'function_call',
          id: 'fc_' + rid(),
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: 'completed',
        });
      }
    }
  }

  return response;
}

// ─── Streaming response conversion ─────────────────────────────────

/**
 * Transform an upstream Chat Completions SSE stream into a Responses API SSE stream.
 *
 * Returns { stream, usagePromise } — same pattern as processStream() in handler.js.
 */
export function chatCompletionsStreamToResponsesStream(upstreamBody, model) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const responseId = 'resp_' + rid();
  let buffer = '';
  let capturedUsage = null;
  let resolveUsage;
  const usagePromise = new Promise(resolve => { resolveUsage = resolve; });

  // State tracking for output items
  let messageItem = null;
  let messageItemIdx = -1;
  let contentPartOpen = false;
  const toolCalls = {};   // upstream tc.index -> { item, outputIdx }
  let nextOutputIdx = 0;
  let sequenceNumber = 0;

  const responseObject = {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'in_progress',
    model: model || 'unknown',
    output: [],
    usage: { input_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 0 },
    error: null,
  };

  function seq() { return sequenceNumber++; }

  function send(ctrl, data) {
    ctrl.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
  }

  function closeMessage(ctrl) {
    if (!messageItem || !contentPartOpen) return;
    const cpIdx = messageItem.content.length - 1;
    const cp = messageItem.content[cpIdx];
    send(ctrl, { type: 'response.output_text.done', item_id: messageItem.id, output_index: messageItemIdx, content_index: cpIdx, text: cp.text, sequence_number: seq() });
    send(ctrl, { type: 'response.content_part.done', item_id: messageItem.id, output_index: messageItemIdx, content_index: cpIdx, part: cp, sequence_number: seq() });
    contentPartOpen = false;
    messageItem.status = 'completed';
    send(ctrl, { type: 'response.output_item.done', output_index: messageItemIdx, item: messageItem, sequence_number: seq() });
    messageItem = null;
  }

  function closeToolCalls(ctrl) {
    for (const tcIdx in toolCalls) {
      const tc = toolCalls[tcIdx];
      send(ctrl, { type: 'response.function_call_arguments.done', item_id: tc.item.id, output_index: tc.outputIdx, arguments: tc.item.arguments, sequence_number: seq() });
      tc.item.status = 'completed';
      send(ctrl, { type: 'response.output_item.done', output_index: tc.outputIdx, item: tc.item, sequence_number: seq() });
    }
  }

  const stream = new ReadableStream({
    async start(ctrl) {
      send(ctrl, { type: 'response.created', response: { ...responseObject }, sequence_number: seq() });
      send(ctrl, { type: 'response.in_progress', response: { ...responseObject }, sequence_number: seq() });

      const reader = upstreamBody.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += dec.decode(value, { stream: true });
          const parts = buffer.split('\n');
          buffer = parts.pop() || '';

          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') continue;

            let data;
            try { data = JSON.parse(jsonStr); } catch { continue; }

            if (data.usage) capturedUsage = data.usage;
            if (!data.choices || data.choices.length === 0) continue;

            const choice = data.choices[0];
            const delta = choice.delta || {};

            // ── Text content ──
            if (delta.content) {
              if (!messageItem) {
                messageItem = { id: 'msg_' + rid(), type: 'message', role: 'assistant', status: 'in_progress', content: [] };
                messageItemIdx = nextOutputIdx++;
                send(ctrl, { type: 'response.output_item.added', output_index: messageItemIdx, item: messageItem, sequence_number: seq() });
              }
              if (!contentPartOpen) {
                contentPartOpen = true;
                const cp = { type: 'output_text', text: '', annotations: [] };
                messageItem.content.push(cp);
                send(ctrl, { type: 'response.content_part.added', item_id: messageItem.id, output_index: messageItemIdx, content_index: messageItem.content.length - 1, part: cp, sequence_number: seq() });
              }
              const cp = messageItem.content[messageItem.content.length - 1];
              cp.text += delta.content;
              send(ctrl, { type: 'response.output_text.delta', item_id: messageItem.id, output_index: messageItemIdx, content_index: messageItem.content.length - 1, delta: delta.content, sequence_number: seq() });
            }

            // ── Tool calls ──
            if (delta.tool_calls) {
              closeMessage(ctrl);
              for (const tc of delta.tool_calls) {
                const tcIdx = tc.index ?? 0;
                if (tc.id && tc.function?.name) {
                  const outputIdx = nextOutputIdx++;
                  const item = { type: 'function_call', id: 'fc_' + rid(), call_id: tc.id, name: tc.function.name, arguments: '', status: 'in_progress' };
                  toolCalls[tcIdx] = { item, outputIdx };
                  send(ctrl, { type: 'response.output_item.added', output_index: outputIdx, item, sequence_number: seq() });
                  if (tc.function.arguments) {
                    item.arguments += tc.function.arguments;
                    send(ctrl, { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: outputIdx, delta: tc.function.arguments, sequence_number: seq() });
                  }
                } else if (tc.function?.arguments && toolCalls[tcIdx]) {
                  const st = toolCalls[tcIdx];
                  st.item.arguments += tc.function.arguments;
                  send(ctrl, { type: 'response.function_call_arguments.delta', item_id: st.item.id, output_index: st.outputIdx, delta: tc.function.arguments, sequence_number: seq() });
                }
              }
            }

            // ── Finish ──
            if (choice.finish_reason) {
              closeMessage(ctrl);
              closeToolCalls(ctrl);
            }
          }
        }
      } finally {
        reader.releaseLock();

        if (capturedUsage) {
          responseObject.usage = {
            input_tokens: capturedUsage.prompt_tokens || 0,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: capturedUsage.completion_tokens || 0,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: (capturedUsage.prompt_tokens || 0) + (capturedUsage.completion_tokens || 0),
          };
        }

        // Collect all output items for the completed response
        const allOutput = [];
        if (messageItem) {
          messageItem.status = 'completed';
          allOutput.push(messageItem);
        }
        for (const tcIdx of Object.keys(toolCalls).sort((a, b) => a - b)) {
          toolCalls[tcIdx].item.status = 'completed';
          allOutput.push(toolCalls[tcIdx].item);
        }
        responseObject.output = allOutput;
        responseObject.status = 'completed';

        send(ctrl, { type: 'response.completed', response: responseObject, sequence_number: seq() });
        resolveUsage(capturedUsage);
        ctrl.close();
      }
    },
  });

  return { stream, usagePromise };
}

// ─── Helpers ────────────────────────────────────────────────────────

function rid() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
}
