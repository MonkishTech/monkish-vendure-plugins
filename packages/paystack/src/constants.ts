import { CurrencyCode } from './types';

export const loggerCtx = 'PaystackPlugin';

export const SUPPORTED_CURRENCICES: CurrencyCode[] = [
  'NGN',
  'USD',
  'GHS',
  'ZAR',
  'KES',
];

export const PAYSTACK_API_URL = 'https://api.paystack.co';

/** Custom metadata key set on initialize; echoed on webhooks to resolve the Vendure order. */
export const PAYSTACK_ORDER_CODE_METADATA_KEY = 'order_code';
