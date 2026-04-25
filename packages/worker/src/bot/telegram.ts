import type { Bus } from '../bus';
import type { Escalate } from '../events';

export type TelegramConfig = { token: string; chatId: string };

export async function sendEscalation(cfg: TelegramConfig, e: Escalate): Promise<void> {
  const text =
    `⚠️ *Hydra escalation*\n` +
    `Reason: ${e.payload.reason}\n` +
    `Recommendation: *${e.payload.recommendation.action}* (conf ${(e.payload.recommendation.confidence * 100).toFixed(0)}%)\n` +
    `_${e.payload.recommendation.rationale}_`;
  const correlate = e.payload.correlatesTo;
  const body = {
    chat_id: cfg.chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve:${correlate}` },
        { text: '❌ Override', callback_data: `override:${correlate}` },
      ]],
    },
  };
  const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('[telegram] sendMessage failed', res.status, await res.text());
}

export async function answerCallback(cfg: TelegramConfig, callbackQueryId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${cfg.token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export function attachTelegramSender(bus: Bus, cfg: TelegramConfig): () => void {
  return bus.on('ESCALATE', (e) => { void sendEscalation(cfg, e); });
}

export function parseCallback(update: unknown): {
  decision: 'approve' | 'override';
  correlatesTo: string;
  cqId: string;
  chatId?: number;
  messageId?: number;
} | null {
  const u = update as {
    callback_query?: {
      id: string;
      data?: string;
      message?: { message_id: number; chat: { id: number } };
    };
  };
  const cq = u?.callback_query;
  if (!cq || typeof cq.data !== 'string') return null;
  const [decision, correlatesTo] = cq.data.split(':');
  if (decision !== 'approve' && decision !== 'override') return null;
  return {
    decision,
    correlatesTo,
    cqId: cq.id,
    chatId: cq.message?.chat.id,
    messageId: cq.message?.message_id,
  };
}

/** Replace a previously-sent escalation message's text and remove its inline buttons. */
export async function resolveEscalationMessage(
  cfg: TelegramConfig,
  args: { chatId: number; messageId: number; decision: 'approve' | 'override' },
): Promise<void> {
  const text =
    args.decision === 'approve'
      ? '✅ *Approved* — submitting rebalance.'
      : '❌ *Overridden* — no action taken.';
  const res = await fetch(`https://api.telegram.org/bot${cfg.token}/editMessageText`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: args.chatId,
      message_id: args.messageId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] },
    }),
  });
  if (!res.ok) console.error('[telegram] editMessageText failed', res.status, await res.text());
}
