export interface MpesaPaymentStatusUpdate {
  transactionId: string;
  status: 'SUCCESS' | 'FAILED';
  message: string;
}

export interface MpesaPaymentStatusBus {
  publish(update: MpesaPaymentStatusUpdate): Promise<void>;
  subscribe(
    transactionId: string,
    onUpdate: (update: MpesaPaymentStatusUpdate) => void
  ): Promise<() => void>;
}
