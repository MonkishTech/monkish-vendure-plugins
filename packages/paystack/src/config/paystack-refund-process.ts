import { RefundProcess } from '@vendure/core/dist/config/refund/refund-process';

declare module '@vendure/core' {
  interface RefundStates {
    Validating: never;
  }
}

export const paystackRefundProcess: RefundProcess<'Validating'> = {
  transitions: {
    Pending: {
      to: ['Validating'],
      mergeStrategy: 'merge',
    },
    Validating: {
      to: ['Settled', 'Failed'],
      mergeStrategy: 'replace',
    },
  },
};
