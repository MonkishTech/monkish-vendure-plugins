import { describe, expect, it } from 'vitest';

import { InMemoryMpesaPaymentStatusBus } from './in-memory-mpesa-payment-status-bus';

describe('InMemoryMpesaPaymentStatusBus', () => {
  it('delivers a publish to subscribers of that transaction only', async () => {
    const bus = new InMemoryMpesaPaymentStatusBus();
    const seen: string[] = [];
    const other: string[] = [];
    await bus.subscribe('ws_CO_a', (update) => {
      seen.push(update.status);
    });
    await bus.subscribe('ws_CO_b', (update) => {
      other.push(update.status);
    });

    await bus.publish({
      transactionId: 'ws_CO_a',
      status: 'SUCCESS',
      message: 'Payment has been successfully completed',
    });

    expect(seen).toEqual(['SUCCESS']);
    expect(other).toEqual([]);
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = new InMemoryMpesaPaymentStatusBus();
    const seen: string[] = [];
    const stop = await bus.subscribe('ws_CO_a', (update) => {
      seen.push(update.status);
    });
    stop();

    await bus.publish({
      transactionId: 'ws_CO_a',
      status: 'FAILED',
      message: 'Payment has failed',
    });

    expect(seen).toEqual([]);
  });
});
