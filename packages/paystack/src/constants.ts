import { CurrencyCode } from './types';

export const loggerCtx = 'PaystackPlugin';
export const PLUGIN_INIT_OPTIONS = Symbol('PLUGIN_INIT_OPTIONS');

export const SUPPORTED_CURRENCICES: CurrencyCode[] = [
  'NGN',
  'USD',
  'GHS',
  'ZAR',
  'KES',
];
