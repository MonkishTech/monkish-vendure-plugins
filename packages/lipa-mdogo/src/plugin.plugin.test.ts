import path from 'path';
import { rm } from 'node:fs/promises';
import gqlTag from 'graphql-tag';
import {
  EventBus,
  LanguageCode,
  Order,
  OrderService,
  PaymentMethodHandler,
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import {
  createTestEnvironment,
  registerInitializer,
  SimpleGraphQLClient,
  SqljsInitializer,
} from '@vendure/testing';
import { LipaMdogoPlugin } from './lipa-mdogo.plugin';
import {
  LipaMdogoPlanCompletedEvent,
  LipaMdogoPlanMissedEvent,
  LipaMdogoReminderEvent,
} from './events';
import { lipaMdogoPlansTask } from './service/lipa-mdogo.task';
import { addItem, getCustomerList, initialData, testConfig } from '~utils';

const API_PORT = 3060;
const TEST_DB_DIR = path.join(__dirname, '../__test_db__');

export const clock = { now: new Date('2026-10-13T12:00:00.000Z') };
export const paymentControl = { deduct: 0 };
export const refundControl = { fail: false };

const testPaymentHandler = new PaymentMethodHandler({
  code: 'test-payment',
  description: [{ languageCode: LanguageCode.en, value: 'Test payment' }],
  args: {},
  createPayment: async (_ctx, _order, amount) => ({
    amount: amount - paymentControl.deduct,
    state: 'Settled' as const,
    transactionId: 'pay-1',
    metadata: {},
  }),
  settlePayment: async () => ({ success: true }),
  createRefund: async () => {
    if (refundControl.fail) {
      throw new Error('refund failed');
    }
    return {
      state: 'Settled' as const,
      transactionId: 'refund-1',
      metadata: {},
    };
  },
});

const Start = gqlTag`
  mutation Start($input: StartLipaMdogoPlanInput!) {
    startLipaMdogoPlan(input: $input) {
      minimumPayment
      deadline
      outstanding
      minimumDue
      state
    }
  }
`;

const ActivePlan = gqlTag`
  query ActivePlan {
    activeOrder {
      id
      code
      state
      totalWithTax
      lipaMdogoPlan {
        minimumPayment
        outstanding
        minimumDue
        state
      }
    }
    eligibleShippingMethods {
      id
    }
  }
`;

describe('Lipa mdogo plugin', () => {
  const { server, adminClient, shopClient } = createTestEnvironment({
    ...testConfig(API_PORT),
    paymentOptions: {
      paymentMethodHandlers: [testPaymentHandler],
    },
    plugins: [LipaMdogoPlugin.init({ clock: () => clock.now })],
  });

  let customerEmail = '';
  let variantA = '';
  let variantB = '';

  beforeAll(async () => {
    registerInitializer('sqljs', new SqljsInitializer(TEST_DB_DIR));
    await server.init({
      productsCsvPath: path.join(
        __dirname,
        '../../../utils/src/e2e/products.csv'
      ),
      initialData: {
        ...initialData,
        paymentMethods: [
          {
            name: 'test-payment',
            handler: { code: 'test-payment', arguments: [] },
          },
        ],
      },
      customerCount: 2,
    });
    await adminClient.asSuperAdmin();
    const variants = await adminClient.query(gqlTag`
      query Variants {
        productVariants(options: { take: 2, sort: { id: ASC } }) {
          items {
            id
          }
        }
      }
    `);
    variantA = variants.productVariants.items[0].id;
    variantB = variants.productVariants.items[1].id;
    customerEmail = (await getCustomerList(adminClient, { take: 1 })).customers
      .items[0].emailAddress;
  }, 120000);

  afterAll(async () => {
    await server.destroy();
    await rm(TEST_DB_DIR, { recursive: true });
  });

  beforeEach(() => {
    clock.now = new Date('2026-10-13T12:00:00.000Z');
    paymentControl.deduct = 0;
    refundControl.fail = false;
  });

  it('exposes lipa mdogo fields on a variant', async () => {
    const deadline = '2026-11-12T15:00:00.000Z';
    await adminClient.query(
      gqlTag`
        mutation Enable($input: [UpdateProductVariantInput!]!) {
          updateProductVariants(input: $input) {
            id
          }
        }
      `,
      {
        input: [
          {
            id: variantA,
            customFields: {
              lipaMdogoEnabled: true,
              lipaMdogoMinimum: 100,
              lipaMdogoDeadline: deadline,
            },
          },
        ],
      }
    );
    await shopClient.asUserWithCredentials(customerEmail, 'test');
    await addItem(shopClient, variantA, 1);
    const loaded = await shopClient.query(gqlTag`
      query LineFields {
        activeOrder {
          lines {
          productVariant {
            customFields {
              lipaMdogoEnabled
              lipaMdogoMinimum
              lipaMdogoDeadline
            }
          }
          }
        }
      }
    `);
    expect(
      loaded.activeOrder.lines[0].productVariant.customFields
    ).toMatchObject({
      lipaMdogoEnabled: true,
      lipaMdogoMinimum: 100,
      lipaMdogoDeadline: deadline,
    });
    const untouched = await adminClient.query(
      gqlTag`
        query Other($id: ID!) {
        productVariant(id: $id) {
          customFields {
            lipaMdogoEnabled
            lipaMdogoMinimum
            lipaMdogoDeadline
          }
        }
        }
      `,
      { id: variantB }
    );
    expect(untouched.productVariant.customFields).toMatchObject({
      lipaMdogoEnabled: false,
      lipaMdogoMinimum: 0,
      lipaMdogoDeadline: null,
    });
    await cancelActiveOrder(shopClient);
  });

  async function arrangeArrangingPayment(client: SimpleGraphQLClient) {
    await client.asUserWithCredentials(customerEmail, 'test');
    const before = await client.query(ActivePlan);
    if (before.activeOrder?.state === 'ArrangingPayment') {
      return before.activeOrder;
    }
    if (!before.activeOrder) {
      await addItem(client, 1, 1);
    }
    await client.query(gqlTag`
      mutation {
        setOrderShippingAddress(
          input: {
            fullName: "Ada Lovelace"
            streetLine1: "1 Market Street"
            city: "Nairobi"
            postalCode: "00100"
            countryCode: "KE"
          }
        ) {
          ... on Order {
            id
          }
        }
      }
    `);
    const withMethods = await client.query(ActivePlan);
    await client.query(
      gqlTag`
        mutation SetShipping($ids: [ID!]!) {
          setOrderShippingMethod(shippingMethodId: $ids) {
            ... on Order {
              id
            }
          }
        }
      `,
      { ids: [withMethods.eligibleShippingMethods[0].id] }
    );
    const transitioned = await client.query(gqlTag`
      mutation {
        transitionOrderToState(state: "ArrangingPayment") {
          ... on Order {
            id
            code
            state
            totalWithTax
          }
          ... on OrderStateTransitionError {
            message
          }
        }
      }
    `);
    const order = transitioned.transitionOrderToState;
    if (order.state !== 'ArrangingPayment') {
      throw new Error(order.message ?? 'Order did not reach ArrangingPayment');
    }
    return order;
  }

  async function cancelActiveOrder(client: SimpleGraphQLClient) {
    await client.query(gqlTag`
      mutation {
        transitionOrderToState(state: "Cancelled") {
          ... on Order {
            state
          }
        }
      }
    `);
  }

  it('starts a plan and reports the minimum as the amount due', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const deadline = '2026-11-12T15:00:00.000Z';
    const result = await shopClient.query(Start, {
      input: { minimumPayment: 100, deadline },
    });
    expect(result.startLipaMdogoPlan).toMatchObject({
      minimumPayment: 100,
      outstanding: order.totalWithTax,
      minimumDue: 100,
      state: 'Active',
    });
    expect(new Date(result.startLipaMdogoPlan.deadline).toISOString()).toBe(
      deadline
    );
    const loaded = await shopClient.query(ActivePlan);
    expect(loaded.activeOrder.lipaMdogoPlan.state).toBe('Active');
    await cancelActiveOrder(shopClient);
  });

  it('rejects a start when there is no active order', async () => {
    await shopClient.asUserWithCredentials(customerEmail, 'test');
    await expect(
      shopClient.query(Start, {
        input: {
          minimumPayment: 100,
          deadline: '2026-11-12T15:00:00.000Z',
        },
      })
    ).rejects.toThrow('No active order found for session');
  });

  it('rejects a start when the order has no customer', async () => {
    await arrangeArrangingPayment(shopClient);
    const active = await shopClient.query(ActivePlan);
    const requestContextService = server.app.get(RequestContextService);
    const connection = server.app.get(TransactionalConnection);
    const ctx = await requestContextService.create({ apiType: 'admin' });
    const id = Number.parseInt(active.activeOrder.id.replace(/^T_/, ''), 10);
    await connection.getRepository(ctx, Order).update(id, { customer: null });
    await expect(
      shopClient.query(Start, {
        input: {
          minimumPayment: 100,
          deadline: '2026-11-12T15:00:00.000Z',
        },
      })
    ).rejects.toThrow('No customer found for active order');
    await cancelActiveOrder(shopClient);
  });

  it('rejects a start when the order is not ArrangingPayment', async () => {
    await shopClient.asUserWithCredentials(customerEmail, 'test');
    await addItem(shopClient, 1, 1);
    await expect(
      shopClient.query(Start, {
        input: {
          minimumPayment: 100,
          deadline: '2026-11-12T15:00:00.000Z',
        },
      })
    ).rejects.toThrow('Lipa mdogo requires the order to be ArrangingPayment.');
    const loaded = await shopClient.query(ActivePlan);
    expect(loaded.activeOrder?.lipaMdogoPlan ?? null).toBeNull();
    await cancelActiveOrder(shopClient);
  });

  it('rejects a minimum that is not a positive integer', async () => {
    await arrangeArrangingPayment(shopClient);
    await expect(
      shopClient.query(Start, {
        input: {
          minimumPayment: 0,
          deadline: '2026-11-12T15:00:00.000Z',
        },
      })
    ).rejects.toThrow('minimumPayment must be a positive integer.');
    const loaded = await shopClient.query(ActivePlan);
    expect(loaded.activeOrder?.lipaMdogoPlan ?? null).toBeNull();
    await cancelActiveOrder(shopClient);
  });

  it('rejects a minimum above the order total', async () => {
    await arrangeArrangingPayment(shopClient);
    await expect(
      shopClient.query(Start, {
        input: {
          minimumPayment: 2_000_000_000,
          deadline: '2026-11-12T15:00:00.000Z',
        },
      })
    ).rejects.toThrow('minimumPayment cannot exceed the order total.');
    const loaded = await shopClient.query(ActivePlan);
    expect(loaded.activeOrder?.lipaMdogoPlan ?? null).toBeNull();
    await cancelActiveOrder(shopClient);
  });

  it('rejects a deadline that is not in the future', async () => {
    await arrangeArrangingPayment(shopClient);
    await expect(
      shopClient.query(Start, {
        input: {
          minimumPayment: 100,
          deadline: '2026-10-13T12:00:00.000Z',
        },
      })
    ).rejects.toThrow('deadline must be in the future.');
    const loaded = await shopClient.query(ActivePlan);
    expect(loaded.activeOrder?.lipaMdogoPlan ?? null).toBeNull();
    await cancelActiveOrder(shopClient);
  });

  it('rejects a negative reminder offset', async () => {
    await arrangeArrangingPayment(shopClient);
    await expect(
      shopClient.query(Start, {
        input: {
          minimumPayment: 100,
          deadline: '2026-11-12T15:00:00.000Z',
          reminderDaysBefore: [-1],
        },
      })
    ).rejects.toThrow(
      'reminderDaysBefore must be a list of integers greater than or equal to zero.'
    );
    const loaded = await shopClient.query(ActivePlan);
    expect(loaded.activeOrder?.lipaMdogoPlan ?? null).toBeNull();
    await cancelActiveOrder(shopClient);
  });

  it('rejects a second plan on the same order', async () => {
    await arrangeArrangingPayment(shopClient);
    const input = {
      minimumPayment: 100,
      deadline: '2026-11-12T15:00:00.000Z',
    };
    await shopClient.query(Start, { input });
    await expect(shopClient.query(Start, { input })).rejects.toThrow(
      'This order already has a lipa mdogo plan.'
    );
    await cancelActiveOrder(shopClient);
  });

  it('reports the outstanding balance when it is below the minimum', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const minimumPayment = order.totalWithTax - 100;
    await shopClient.query(Start, {
      input: {
        minimumPayment,
        deadline: '2026-11-12T15:00:00.000Z',
      },
    });
    paymentControl.deduct = 50;
    await shopClient.query(
      gqlTag`
        mutation Pay($input: PaymentInput!) {
          addPaymentToOrder(input: $input) {
            ... on Order { id }
            ... on ErrorResult { errorCode message }
          }
        }
      `,
      { input: { method: 'test-payment', metadata: {} } }
    );
    const loaded = await shopClient.query(ActivePlan);
    expect(loaded.activeOrder.lipaMdogoPlan.outstanding).toBe(50);
    expect(loaded.activeOrder.lipaMdogoPlan.minimumDue).toBe(50);
    expect(loaded.activeOrder.lipaMdogoPlan.minimumPayment).toBe(
      minimumPayment
    );
    await cancelActiveOrder(shopClient);
  });

  it('publishes the seven-day reminder once', async () => {
    await arrangeArrangingPayment(shopClient);
    await shopClient.query(Start, {
      input: {
        minimumPayment: 100,
        deadline: '2026-11-12T15:00:00.000Z',
      },
    });
    const events: LipaMdogoReminderEvent[] = [];
    const sub = server.app
      .get(EventBus)
      .ofType(LipaMdogoReminderEvent)
      .subscribe((event) => events.push(event));
    clock.now = new Date('2026-11-05T00:00:00.000Z');
    await lipaMdogoPlansTask.execute(server.app);
    await lipaMdogoPlansTask.execute(server.app);
    sub.unsubscribe();
    expect(events).toHaveLength(1);
    expect(events[0].daysBefore).toBe(7);
    expect(events[0].outstanding).toBeGreaterThan(0);
    await cancelActiveOrder(shopClient);
  });

  it('does not publish an offset that was already due when the plan started', async () => {
    await arrangeArrangingPayment(shopClient);
    await shopClient.query(Start, {
      input: {
        minimumPayment: 100,
        deadline: '2026-10-15T15:00:00.000Z',
      },
    });
    const events: LipaMdogoReminderEvent[] = [];
    const sub = server.app
      .get(EventBus)
      .ofType(LipaMdogoReminderEvent)
      .subscribe((event) => events.push(event));
    await lipaMdogoPlansTask.execute(server.app);
    sub.unsubscribe();
    expect(events).toHaveLength(0);
    await cancelActiveOrder(shopClient);
  });

  it('publishes nothing when the start call passes an empty reminder list', async () => {
    await arrangeArrangingPayment(shopClient);
    await shopClient.query(Start, {
      input: {
        minimumPayment: 100,
        deadline: '2026-11-12T15:00:00.000Z',
        reminderDaysBefore: [],
      },
    });
    const events: LipaMdogoReminderEvent[] = [];
    const sub = server.app
      .get(EventBus)
      .ofType(LipaMdogoReminderEvent)
      .subscribe((event) => events.push(event));
    clock.now = new Date('2026-11-12T14:00:00.000Z');
    await lipaMdogoPlansTask.execute(server.app);
    sub.unsubscribe();
    expect(events).toHaveLength(0);
    await cancelActiveOrder(shopClient);
  });

  it('completes the plan when settled payments cover the order', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    await shopClient.query(Start, {
      input: {
        minimumPayment: 100,
        deadline: '2026-10-14T15:00:00.000Z',
      },
    });
    await adminClient.query(
      gqlTag`
        mutation Pay($input: ManualPaymentInput!) {
          addManualPaymentToOrder(input: $input) {
            ... on Order { state }
            ... on ErrorResult { message }
          }
        }
      `,
      {
        input: {
          orderId: order.id,
          method: 'test-payment',
          transactionId: 'pay-full',
          metadata: {},
        },
      }
    );
    const events: LipaMdogoPlanCompletedEvent[] = [];
    const sub = server.app
      .get(EventBus)
      .ofType(LipaMdogoPlanCompletedEvent)
      .subscribe((event) => events.push(event));
    clock.now = new Date('2026-10-20T15:00:00.000Z');
    await lipaMdogoPlansTask.execute(server.app);
    sub.unsubscribe();
    const loaded = await adminClient.query(
      gqlTag`
        query OrderPlan($id: ID!) {
          order(id: $id) {
            lipaMdogoPlan { state }
          }
        }
      `,
      { id: order.id }
    );
    expect(loaded.order.lipaMdogoPlan.state).toBe('Completed');
    expect(events).toHaveLength(1);
    await cancelActiveOrder(shopClient);
  });

  it('refunds settled payments and cancels the order when the deadline has passed', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    await shopClient.query(Start, {
      input: {
        minimumPayment: 100,
        deadline: '2026-10-20T15:00:00.000Z',
      },
    });
    paymentControl.deduct = order.totalWithTax - 100;
    await shopClient.query(
      gqlTag`
        mutation Pay($input: PaymentInput!) {
          addPaymentToOrder(input: $input) {
            ... on Order { id }
            ... on ErrorResult { errorCode message }
          }
        }
      `,
      { input: { method: 'test-payment', metadata: {} } }
    );
    const events: LipaMdogoPlanMissedEvent[] = [];
    const sub = server.app
      .get(EventBus)
      .ofType(LipaMdogoPlanMissedEvent)
      .subscribe((event) => events.push(event));
    clock.now = new Date('2026-10-20T15:00:00.000Z');
    await lipaMdogoPlansTask.execute(server.app);
    sub.unsubscribe();
    const loaded = await adminClient.query(
      gqlTag`
        query Missed($id: ID!) {
          order(id: $id) {
            state
            lipaMdogoPlan { state }
            payments { amount refunds { state total } }
          }
        }
      `,
      { id: order.id }
    );
    expect(loaded.order.state).toBe('Cancelled');
    expect(loaded.order.lipaMdogoPlan.state).toBe('Missed');
    expect(loaded.order.payments[0].refunds[0].state).toBe('Settled');
    expect(loaded.order.payments[0].refunds[0].total).toBe(100);
    expect(events).toHaveLength(1);
  });

  it('leaves the plan active when the refund fails, then finishes on the next run', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    await shopClient.query(Start, {
      input: {
        minimumPayment: 100,
        deadline: '2026-10-20T15:00:00.000Z',
      },
    });
    paymentControl.deduct = order.totalWithTax - 100;
    await shopClient.query(
      gqlTag`
        mutation Pay($input: PaymentInput!) {
          addPaymentToOrder(input: $input) {
            ... on Order { id }
            ... on ErrorResult { errorCode message }
          }
        }
      `,
      { input: { method: 'test-payment', metadata: {} } }
    );
    refundControl.fail = true;
    clock.now = new Date('2026-10-20T15:00:00.000Z');
    await lipaMdogoPlansTask.execute(server.app);
    const midway = await adminClient.query(
      gqlTag`
        query Mid($id: ID!) {
          order(id: $id) { state lipaMdogoPlan { state } }
        }
      `,
      { id: order.id }
    );
    expect(midway.order.state).toBe('ArrangingPayment');
    expect(midway.order.lipaMdogoPlan.state).toBe('Active');
    refundControl.fail = false;
    await lipaMdogoPlansTask.execute(server.app);
    const done = await adminClient.query(
      gqlTag`
        query Done($id: ID!) {
          order(id: $id) { state lipaMdogoPlan { state } }
        }
      `,
      { id: order.id }
    );
    expect(done.order.state).toBe('Cancelled');
    expect(done.order.lipaMdogoPlan.state).toBe('Missed');
  });

  it('marks a cancelled order missed without a missed event', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    await shopClient.query(Start, {
      input: {
        minimumPayment: 100,
        deadline: '2026-11-12T15:00:00.000Z',
      },
    });
    await cancelActiveOrder(shopClient);
    const events: LipaMdogoPlanMissedEvent[] = [];
    const sub = server.app
      .get(EventBus)
      .ofType(LipaMdogoPlanMissedEvent)
      .subscribe((event) => events.push(event));
    await lipaMdogoPlansTask.execute(server.app);
    sub.unsubscribe();
    expect(events).toHaveLength(0);
    const loaded = await adminClient.query(
      gqlTag`
        query CancelledPlan($id: ID!) {
          order(id: $id) { lipaMdogoPlan { state } }
        }
      `,
      { id: order.id }
    );
    expect(loaded.order.lipaMdogoPlan.state).toBe('Missed');
  });

  it('leaves the plan active when the order cannot be loaded', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    await shopClient.query(Start, {
      input: {
        minimumPayment: 100,
        deadline: '2026-10-20T15:00:00.000Z',
      },
    });
    const orderService = server.app.get(OrderService);
    const findOne = orderService.findOne.bind(orderService);
    orderService.findOne = async () => undefined;
    clock.now = new Date('2026-10-20T15:00:00.000Z');
    try {
      await lipaMdogoPlansTask.execute(server.app);
    } finally {
      orderService.findOne = findOne;
    }
    const loaded = await adminClient.query(
      gqlTag`
        query StillActive($id: ID!) {
          order(id: $id) { lipaMdogoPlan { state } }
        }
      `,
      { id: order.id }
    );
    expect(loaded.order.lipaMdogoPlan.state).toBe('Active');
    await cancelActiveOrder(shopClient);
  });
});
