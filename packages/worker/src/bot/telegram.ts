import type { Bus } from '../bus';
import type { Escalate } from '../events';

export type TelegramConfig = { token: string; chatId: string };

export async function sendEscalation(cfg: TelegramConfig, e: Escalate): Promise<void> {
  const text =
    `⚠️ *Hydra escalation*\n` +
    `Reason: ${e.payload.reason}\n` +
    `Recommendation: *${e.payload.recommendation.action}* (conf ${(e.payload.recommendation.confidence * 100).toFixed(0)}%)\n` +
    `_${e.payload.recommendation.rationale}_`;
  const body = {
    chat_id: cfg.chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve:${e.id}` },
        { text: '❌ Override', callback_data: `override:${e.id}` },
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

export function parseCallback(update: unknown): { decision: 'approve' | 'override'; correlatesTo: string; cqId: string } | null {
  const u = update as { callback_query?: { id: string; data?: string } };
  const cq = u?.callback_query;
  if (!cq || typeof cq.data !== 'string') return null;
  const [decision, correlatesTo] = cq.data.split(':');
  if (decision !== 'approve' && decision !== 'override') return null;
  return { decision, correlatesTo, cqId: cq.id };
}
