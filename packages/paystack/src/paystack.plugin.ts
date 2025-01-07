import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { PLUGIN_INIT_OPTIONS } from './constants';
import { PaystackService } from './service/paystack.service';
import { shopApiSchemaExtensions } from './api/extensions';
import { PaystackResolver } from './api/paystack.resolver';
import { PaystackController } from './api/paystack.controller';
import { configuration } from './config/runtime-config';

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
  compatibility: '>1',
  controllers: [PaystackController],
  imports: [PluginCommonModule],
  providers: [
    {
      provide: PLUGIN_INIT_OPTIONS,
      useFactory: () => PaystackPlugin.options,
    },
    PaystackService,
  ],
  shopApiExtensions: {
    schema: shopApiSchemaExtensions,
    resolvers: [PaystackResolver],
  },
  configuration,
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
