import { CurrencyCode } from './types';
import { initialData } from '~utils';

const test = initialData;

export const loggerCtx = 'PaystackPlugin';
export const PLUGIN_INIT_OPTIONS = Symbol('PLUGIN_INIT_OPTIONS');

export const SUPPORTED_CURRENCICES: CurrencyCode[] = [
  'NGN',
  'USD',
  'GHS',
  'ZAR',
  'KES',
];

export const PAYSTACK_API_URL = 'https://api.paystack.co';
