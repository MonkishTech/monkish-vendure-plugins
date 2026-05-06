import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { PaystackService } from './service/paystack.service';
import { shopApiSchemaExtensions } from './api/extensions';
import { PaystackResolver } from './api/paystack.resolver';
import { PaystackController } from './api/paystack.controller';
import { configuration } from './config/runtime-config';

@VendurePlugin({
  compatibility: '>1',
  controllers: [PaystackController],
  imports: [PluginCommonModule],
  providers: [PaystackService],
  shopApiExtensions: {
    schema: shopApiSchemaExtensions,
    resolvers: [PaystackResolver],
  },
  configuration,
})
export class PaystackPlugin {}
