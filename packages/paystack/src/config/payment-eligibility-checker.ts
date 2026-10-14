import {
  LanguageCode,
  Logger,
  PaymentMethodEligibilityChecker,
} from '@vendure/core';
import { loggerCtx, SUPPORTED_CURRENCICES } from '../constants';
import { buildLogMessage } from '../service/log-provider-error';

export const paystackEligibilityChecker = new PaymentMethodEligibilityChecker({
  code: 'paystack-eligibility-checker',
  description: [
    {
      languageCode: LanguageCode.en,
      value: 'Check whether Paystack supports the payment',
    },
  ],
  args: {},
  check: async (_, order) => {
    if (!SUPPORTED_CURRENCICES.includes(order.currencyCode)) {
      Logger.debug(
        buildLogMessage('Paystack currency is not supported', {
          orderCode: order.code,
          currencyCode: order.currencyCode,
        }),
        loggerCtx
      );
      return false;
    }

    return true;
  },
});
