import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';
import { addLipaMdogoCustomFields } from './custom-fields';
import {
  LipaMdogoOrderResolver,
  LipaMdogoShopResolver,
} from './api/lipa-mdogo-shop.resolver';
import { LipaMdogoPlan } from './entity/lipa-mdogo-plan.entity';
import { LipaMdogoService } from './service/lipa-mdogo.service';
import { lipaMdogoPlansTask } from './service/lipa-mdogo.task';
import { RefundSettledPaymentsStrategy } from './service/missed-payment.strategy';
import {
  LipaMdogoMissedPaymentStrategy,
  LipaMdogoPlanStrategy,
} from './service/strategies';

export interface LipaMdogoPluginOptions {
  planStrategy?: LipaMdogoPlanStrategy;
  missedPaymentStrategy?: LipaMdogoMissedPaymentStrategy;
  clock?: () => Date;
}

@VendurePlugin({
  compatibility: '>=3.4.1',
  imports: [PluginCommonModule],
  entities: [LipaMdogoPlan],
  providers: [LipaMdogoService, RefundSettledPaymentsStrategy],
  shopApiExtensions: {
    schema: shopApiExtensions,
    resolvers: [LipaMdogoShopResolver, LipaMdogoOrderResolver],
  },
  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [LipaMdogoOrderResolver],
  },
  configuration: (config) => {
    addLipaMdogoCustomFields(config);
    config.schedulerOptions.tasks.push(lipaMdogoPlansTask);
    return config;
  },
})
export class LipaMdogoPlugin {
  static options: LipaMdogoPluginOptions = {};

  static init(options: LipaMdogoPluginOptions): typeof LipaMdogoPlugin {
    LipaMdogoPlugin.options = options;
    return LipaMdogoPlugin;
  }
}
