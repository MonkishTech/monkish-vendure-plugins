import { Logger } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildLogMessage, logProviderError } from './log-provider-error';

describe('logProviderError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs one line with status, body, and stack, and leaves request config out', () => {
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const err = Object.assign(new Error('initialize failed'), {
      response: { status: 500, data: { errorCode: 'timeout' } },
      config: {
        headers: { Authorization: 'Bearer sk_test_secret_key' },
        data: {
          consumerSecret: 'consumer-secret-value',
          passkey: 'mpesa-passkey',
        },
      },
    });

    logProviderError('Paystack initialize failed', err, { orderCode: 'ORD1' });

    expect(Logger.error).toHaveBeenCalledTimes(1);
    const [message, context, stack] = vi.mocked(Logger.error).mock.calls[0];
    expect(context).toBe('PaystackPlugin');
    expect(message).toContain('orderCode=ORD1');
    expect(message).toContain('httpStatus=500');
    expect(message).toContain('timeout');
    expect(message).toContain('error=initialize failed');
    expect(message).toContain('body=');
    expect(stack).toBe(err.stack);
    expect(message).not.toContain('sk_test_secret_key');
    expect(message).not.toContain('consumer-secret-value');
    expect(message).not.toContain('mpesa-passkey');
    expect(message).not.toContain('config');
  });

  it('keeps a string response body as-is', () => {
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const err = Object.assign(new Error('initialize failed'), {
      response: { status: 400, data: 'raw-body' },
    });

    logProviderError('Paystack initialize failed', err, { orderCode: 'ORD1' });

    const [message] = vi.mocked(Logger.error).mock.calls[0];
    expect(message).toContain('body=raw-body');
  });

  it('logs a plain Error with the stack and no body', () => {
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const err = new Error('nope');

    logProviderError('Paystack initialize failed', err);

    expect(Logger.error).toHaveBeenCalledTimes(1);
    const [message, , stack] = vi.mocked(Logger.error).mock.calls[0];
    expect(message).toContain('error=nope');
    expect(message).not.toContain('body=');
    expect(stack).toBe(err.stack);
  });

  it('omits body when the response has no data', () => {
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const err = Object.assign(new Error('empty'), {
      response: { status: 502 },
    });

    logProviderError('Paystack initialize failed', err, { orderCode: 'ORD1' });

    const [message] = vi.mocked(Logger.error).mock.calls[0];
    expect(message).toContain('httpStatus=502');
    expect(message).not.toContain('body=');
  });

  it('logs a non-Error value with no stack', () => {
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined);

    logProviderError('Paystack initialize failed', 'boom', {
      orderCode: 'ORD1',
    });

    expect(Logger.error).toHaveBeenCalledTimes(1);
    const [message, , stack] = vi.mocked(Logger.error).mock.calls[0];
    expect(message).toContain('error=boom');
    expect(message).toContain('orderCode=ORD1');
    expect(stack).toBeUndefined();
  });
});

describe('buildLogMessage', () => {
  it('drops null, undefined, and empty strings', () => {
    expect(
      buildLogMessage('Refund settled', {
        transactionId: 'ABC',
        orderCode: undefined,
        receipt: null,
        note: '',
      })
    ).toBe('Refund settled: transactionId=ABC');
  });

  it('returns the sentence when every identifier is empty', () => {
    expect(buildLogMessage('Refund settled', { orderCode: '' })).toBe(
      'Refund settled'
    );
  });
});
