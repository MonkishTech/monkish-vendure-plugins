import { VendurePlugin } from '@vendure/core';
import { PLUGIN_INIT_OPTIONS } from './constants';
import { PaystackService } from './service/paystack.service';

/**
 * @description
 * Configuration options for the Paystack plugin.
 */
export interface PaystackPluginOptions {
  /**
   * @description
   * Your Paystack secret key.
   * https://paystack.com/docs/api/authentication/
   */
  secretKey: string;
}

@VendurePlugin({
  providers: [
    {
      provide: PLUGIN_INIT_OPTIONS,
      useFactory: () => PaystackPlugin.options,
    },
    PaystackService,
  ],
})
export class PaystackPlugin {
  static options: PaystackPluginOptions;

  /**
   * @description
   * Initialize the Paystack payment plugin
   * @param secretKey is required
   */
  static init(options: PaystackPluginOptions): typeof PaystackPlugin {
    this.options = options;
    return PaystackPlugin;
  }
}
