import { PluginConfigurationFn } from '@vendure/core';
import { paystackPaymentMethodHandler } from './paystack.handler';
import { paystackEligibilityChecker } from './payment-eligibility-checker';
import { paystackRefundProcess } from './paystack-refund-process';

export const configuration: PluginConfigurationFn = (config) => {
  config.paymentOptions.paymentMethodHandlers.push(
    paystackPaymentMethodHandler
  );
  config.paymentOptions.paymentMethodEligibilityCheckers?.push(
    paystackEligibilityChecker
  );
  config.paymentOptions.refundProcess?.push(paystackRefundProcess);

  return config;
};
