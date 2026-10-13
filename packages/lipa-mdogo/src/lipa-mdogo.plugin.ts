import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api/api-extensions';
import {
  LipaMdogoOrderResolver,
  LipaMdogoShopResolver,
} from './api/lipa-mdogo-shop.resolver';
import { LipaMdogoPlan } from './entity/lipa-mdogo-plan.entity';
import { LipaMdogoService } from './service/lipa-mdogo.service';
import { lipaMdogoPlansTask } from './service/lipa-mdogo.task';
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
  providers: [LipaMdogoService],
  shopApiExtensions: {
    schema: shopApiExtensions,
    resolvers: [LipaMdogoShopResolver, LipaMdogoOrderResolver],
  },
  configuration: (config) => {
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
