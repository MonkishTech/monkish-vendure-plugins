import { defineDashboardExtension } from '@vendure/dashboard';

import {
  OrderPlanBlock,
  shouldRenderOrderPlanBlock,
} from './order-plan-block';

defineDashboardExtension({
  detailForms: [
    {
      pageId: 'order-detail',
      extendDetailDocument: `
        query {
          order(id: $id) {
            currencyCode
            lipaMdogoPlan {
              deadline
              outstanding
              minimumDue
              state
            }
          }
        }
      `,
    },
  ],
  pageBlocks: [
    {
      id: 'lipa-mdogo-plan',
      title: 'Lipa mdogo plan',
      location: {
        pageId: 'order-detail',
        column: 'side',
        position: {
          blockId: 'payment-details',
          order: 'after',
        },
      },
      component: OrderPlanBlock,
      shouldRender: shouldRenderOrderPlanBlock,
    },
  ],
});
