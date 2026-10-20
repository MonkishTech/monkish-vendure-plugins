import { describe, expect, it } from 'vitest';

import { MPESA_PAYMENT_STATUS_CHANNEL } from '../constants';
import { RedisMpesaPaymentStatusBus } from './redis-mpesa-payment-status-bus';

class FakeRedis {
  readonly published: { channel: string; message: string }[] = [];
  readonly subscribed: string[] = [];
  private readonly listeners = new Set<
    (channel: string, message: string) => void
  >();

  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    for (const listener of this.listeners) {
      listener(channel, message);
    }
    return 1;
  }

  async subscribe(channel: string): Promise<void> {
    this.subscribed.push(channel);
  }

  on(
    event: 'message',
    listener: (channel: string, message: string) => void
  ): void {
    if (event === 'message') {
      this.listeners.add(listener);
    }
  }
}

describe('RedisMpesaPaymentStatusBus', () => {
  it('publishes JSON on the status channel and delivers it to that transaction only', async () => {
    const redis = new FakeRedis();
    const bus = new RedisMpesaPaymentStatusBus({
      clients: { publisher: redis, subscriber: redis },
    });
    const seen: string[] = [];
    const other: string[] = [];
    await bus.subscribe('ws_CO_a', (update) => {
      seen.push(`${update.status}:${update.message}`);
    });
    await bus.subscribe('ws_CO_b', (update) => {
      other.push(update.transactionId);
    });

    await bus.publish({
      transactionId: 'ws_CO_a',
      status: 'FAILED',
      message: 'Payment has failed',
    });

    expect(redis.subscribed).toEqual([MPESA_PAYMENT_STATUS_CHANNEL]);
    expect(redis.published).toEqual([
      {
        channel: MPESA_PAYMENT_STATUS_CHANNEL,
        message: JSON.stringify({
          transactionId: 'ws_CO_a',
          status: 'FAILED',
          message: 'Payment has failed',
        }),
      },
    ]);
    expect(seen).toEqual(['FAILED:Payment has failed']);
    expect(other).toEqual([]);
  });

  it('ignores a payload for another transaction and a second subscribe does not resubscribe', async () => {
    const redis = new FakeRedis();
    const bus = new RedisMpesaPaymentStatusBus({
      clients: { publisher: redis, subscriber: redis },
    });
    await bus.subscribe('ws_CO_a', () => undefined);
    await bus.subscribe('ws_CO_b', () => undefined);
    expect(redis.subscribed).toEqual([MPESA_PAYMENT_STATUS_CHANNEL]);
  });
});
