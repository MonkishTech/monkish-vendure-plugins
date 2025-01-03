import { PluginConfigurationFn } from '@vendure/core';
import { paystackPaymentMethodHandler } from './paystack.handler';
import { paystackEligibilityChecker } from './payment-eligibility-checker';

export const configuration: PluginConfigurationFn = (config) => {
  config.paymentOptions.paymentMethodHandlers.push(
    paystackPaymentMethodHandler
  );
  config.paymentOptions.paymentMethodEligibilityCheckers?.push(
    paystackEligibilityChecker
  );

  return config;
};
