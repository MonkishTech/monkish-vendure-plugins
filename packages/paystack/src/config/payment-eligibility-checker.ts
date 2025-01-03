import {
  LanguageCode,
  Logger,
  PaymentMethodEligibilityChecker,
} from '@vendure/core';
import { loggerCtx, SUPPORTED_CURRENCICES } from '../constants';

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
      Logger.info(
        `
              Currency code ${order.currencyCode} is not supported by Paystack. 
              Supported currencies are: ${SUPPORTED_CURRENCICES.join(', ')}
            `,
        loggerCtx
      );
      return false;
    }

    return true;
  },
});
