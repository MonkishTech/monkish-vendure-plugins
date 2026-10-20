import { MPESA_PAYMENT_STATUS_CHANNEL } from '../constants';
import {
  MpesaPaymentStatusBus,
  MpesaPaymentStatusUpdate,
} from './mpesa-payment-status-bus';

export interface MpesaRedisConnection {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
}

export interface MpesaRedisClient {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<unknown>;
  on(
    event: 'message',
    listener: (channel: string, message: string) => void
  ): void;
}

export class RedisMpesaPaymentStatusBus implements MpesaPaymentStatusBus {
  private readonly publisher: MpesaRedisClient;
  private readonly subscriber: MpesaRedisClient;
  private readonly listeners = new Map<
    string,
    Set<(update: MpesaPaymentStatusUpdate) => void>
  >();
  private channelSubscribed = false;
  private subscribeChain: Promise<void> = Promise.resolve();

  constructor(
    options:
      | { connection: MpesaRedisConnection }
      | {
          clients: {
            publisher: MpesaRedisClient;
            subscriber: MpesaRedisClient;
          };
        }
  ) {
    if ('clients' in options) {
      this.publisher = options.clients.publisher;
      this.subscriber = options.clients.subscriber;
    } else {
      const Redis = loadIoRedis();
      this.publisher = new Redis(options.connection);
      this.subscriber = new Redis(options.connection);
    }
    this.subscriber.on('message', (channel, message) => {
      if (channel !== MPESA_PAYMENT_STATUS_CHANNEL) {
        return;
      }
      const update = parseUpdate(message);
      if (!update) {
        return;
      }
      const set = this.listeners.get(update.transactionId);
      if (!set) {
        return;
      }
      for (const listener of [...set]) {
        listener(update);
      }
    });
  }

  async publish(update: MpesaPaymentStatusUpdate): Promise<void> {
    await this.publisher.publish(
      MPESA_PAYMENT_STATUS_CHANNEL,
      JSON.stringify(update)
    );
  }

  async subscribe(
    transactionId: string,
    onUpdate: (update: MpesaPaymentStatusUpdate) => void
  ): Promise<() => void> {
    let set = this.listeners.get(transactionId);
    if (!set) {
      set = new Set();
      this.listeners.set(transactionId, set);
    }
    set.add(onUpdate);
    await this.ensureSubscribed();
    return () => {
      set.delete(onUpdate);
      if (set.size === 0) {
        this.listeners.delete(transactionId);
      }
    };
  }

  private async ensureSubscribed(): Promise<void> {
    this.subscribeChain = this.subscribeChain.then(async () => {
      if (this.channelSubscribed) {
        return;
      }
      await this.subscriber.subscribe(MPESA_PAYMENT_STATUS_CHANNEL);
      this.channelSubscribed = true;
    });
    await this.subscribeChain;
  }
}

function parseUpdate(message: string): MpesaPaymentStatusUpdate | undefined {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const update = value as Partial<MpesaPaymentStatusUpdate>;
  if (
    typeof update.transactionId !== 'string' ||
    (update.status !== 'SUCCESS' && update.status !== 'FAILED') ||
    typeof update.message !== 'string'
  ) {
    return;
  }
  return {
    transactionId: update.transactionId,
    status: update.status,
    message: update.message,
  };
}

function loadIoRedis(): new (
  connection: MpesaRedisConnection
) => MpesaRedisClient {
  try {
    // Optional peer. The main plugin entry does not load this module's connection path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('ioredis');
  } catch (error) {
    throw new Error(
      'RedisMpesaPaymentStatusBus requires the optional peer dependency ioredis.',
      { cause: error }
    );
  }
}
