import type OpenAI from 'openai'
import { client, CHAT_MODEL, modelRequestOptions, NO_THINKING, requireApiKey } from './_nebius'
import { requireAiCaller } from './_auth'
import {
  buildCoachPrompt,
  COACH_TOOLS,
  describeAction,
  REFUSED,
  resolveAction,
  scrubReply,
  type CoachAction,
  type CoachContext,
} from './_coach'

export const config = { runtime: 'edge' }

/*
  Chat is the only handler here that makes TWO sequential model calls: one to pick tools,
  then one to write the closing summary once the tool results are known. Both live inside
  the same 25s edge invocation, so they share the budget rather than each getting it.

  Neither call passed options at all before this, which meant the SDK's own defaults —
  `timeout: 600000, maxRetries: 2` — governed a function the platform kills at 25s. A slow
  first call could not degrade; it could only 504.

  The split is uneven on purpose. The first call reasons over the whole conversation and
  emits up to 2048 tokens of tool calls; the second only writes prose over results it has
  already been handed, capped at 512. Splitting evenly would starve the half that does the
  work.
*/
const TOOL_CALL_TIMEOUT_MS = 13000
const SUMMARY_TIMEOUT_MS = 7000

/**
 * A plain receipt of what the tools did, for when the model cannot write the reply itself.
 *
 * Deliberately not a fake coach voice: reading like a receipt is the honest signal that the
 * coach did not get to speak. What matters is that the user can see what landed.
 */
function describeActions(actions: ReadonlyArray<CoachAction>): string {
  const lines = actions.map(describeAction)
  return lines.length === 1 ? lines[0] : lines.map(line => `• ${line}`).join('\n')
}

/** History turns the client may send; anything else is dropped rather than trusted. */
const MAX_HISTORY = 24

/*
  Size caps. The rate limit counts calls, but the caller decides how big each call is, so
  without these one "call" could carry a megabyte of history and cost like a hundred.

  MAX_INPUT_CHARS is measured on what reaches the model, the trimmed history plus the data
  pack, not on the raw body. Trimming already bounds the history, and a client that sends
  more than the server keeps loses its oldest turns silently, as it always has. Measured on
  the raw body, the cap turned a web tab left open long enough into a 413 on every message
  from then on, each refusal becoming one more turn in the next request. After trimming, a
  real request is 24 short turns and a data pack of a few kilobytes, far below the cap
  however long the session; what is still refused is a data pack or a run of pasted turns
  built to fill the model's context. Parsing first is safe: only a verified, rate-limited
  caller gets this far, and the platform caps the body at a few megabytes.
*/
const MAX_INPUT_CHARS = 120_000
const MAX_TURN_CHARS = 4_000

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  // Signed-in users only, within their limits. See ./_auth for why and how.
  const caller = await requireAiCaller(req, 'chat')
  if (caller instanceof Response) return caller

  try {
    requireApiKey()
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]; context: CoachContext }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const { messages } = body
  const context: CoachContext = body.context ?? {}
  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'messages array required' }), { status: 400 })
  }

  // Only user and assistant text turns, and only the recent ones. The client keeps the whole
  // transcript now, and replaying all of it would crowd the data pack out of the budget.
  const history = messages
    .filter(
      (m): m is OpenAI.Chat.Completions.ChatCompletionMessageParam & { content: string } =>
        (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_TURN_CHARS) }) as OpenAI.Chat.Completions.ChatCompletionMessageParam)

  if (JSON.stringify({ history, context }).length > MAX_INPUT_CHARS) {
    return new Response(
      JSON.stringify({
        error: 'That conversation is too long to send. Clear it from the coach menu, or reload the page on the web, then try again.',
      }),
      { status: 413, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const lastUser = [...history].reverse().find(m => m.role === 'user')
  const lastUserMessage = typeof lastUser?.content === 'string' ? lastUser.content : ''

  try {
    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildCoachPrompt(context, lastUserMessage) },
      ...history,
    ]

    const response = await client.chat.completions.create(
      {
        model: CHAT_MODEL,
        max_tokens: 2048,
        tools: COACH_TOOLS,
        messages: convo,
        // A thinking model spends the edge budget before it answers; see api/_photo.ts.
        ...NO_THINKING,
      },
      modelRequestOptions(TOOL_CALL_TIMEOUT_MS),
    )

    const assistantMsg = response.choices[0]?.message
    const toolCalls = (assistantMsg?.tool_calls ?? []) as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]

    const actions: CoachAction[] = []
    const results: { id: string; content: string }[] = []
    let refused = 0

    for (const call of toolCalls) {
      if (call.type !== 'function') continue
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(call.function.arguments || '{}')
      } catch {
        /* treated as unusable below */
      }
      const action = resolveAction(call.function.name, input, context)
      if (action) {
        actions.push(action)
        results.push({ id: call.id, content: describeAction(action) })
      } else {
        refused += 1
        results.push({ id: call.id, content: REFUSED })
      }
    }

    let finalText = ''
    /*
      One round trip when the model already wrote its reply beside the tool calls and every
      call went through. The second call exists to describe results the model has not seen;
      when nothing was refused, its own text already describes them, and skipping the call
      saves two to four seconds of a 25-second budget.
    */
    const ownText = assistantMsg?.content?.trim() ?? ''
    if (toolCalls.length > 0 && refused === 0 && ownText.length > 0) {
      finalText = ownText
    } else if (toolCalls.length > 0) {
      /*
        The actions are resolved at this point, so the work is done. Only the sentence
        describing it is outstanding, and it gets its own try/catch: letting this call's
        failure reach the outer catch would return a 500 and throw away the actions, and the
        user's retry would then log everything twice. Losing prose is a worse sentence;
        losing actions is lost data.
      */
      try {
        const followUp = await client.chat.completions.create(
          {
            model: CHAT_MODEL,
            max_tokens: 512,
            ...NO_THINKING,
            messages: [
              ...convo,
              assistantMsg!,
              ...results.map(r => ({ role: 'tool' as const, tool_call_id: r.id, content: r.content })),
            ],
          },
          modelRequestOptions(SUMMARY_TIMEOUT_MS),
        )
        finalText = followUp.choices[0]?.message?.content ?? ''
      } catch {
        finalText = ''
      }
      if (finalText.trim().length === 0) finalText = actions.length > 0 ? describeActions(actions) : ''
    } else {
      finalText = assistantMsg?.content ?? ''
    }

    return new Response(JSON.stringify({ text: scrubReply(finalText), actions, refused }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 500 })
  }
}
