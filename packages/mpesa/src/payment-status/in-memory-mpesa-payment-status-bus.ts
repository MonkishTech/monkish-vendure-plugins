import {
  MpesaPaymentStatusBus,
  MpesaPaymentStatusUpdate,
} from './mpesa-payment-status-bus';

export class InMemoryMpesaPaymentStatusBus implements MpesaPaymentStatusBus {
  private readonly listeners = new Map<
    string,
    Set<(update: MpesaPaymentStatusUpdate) => void>
  >();

  async publish(update: MpesaPaymentStatusUpdate): Promise<void> {
    const set = this.listeners.get(update.transactionId);
    if (!set) {
      return;
    }
    for (const listener of [...set]) {
      listener(update);
    }
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
    return () => {
      set.delete(onUpdate);
      if (set.size === 0) {
        this.listeners.delete(transactionId);
      }
    };
  }
}
