import path from 'path';
import { rm } from 'node:fs/promises';
import gqlTag from 'graphql-tag';
import {
  LanguageCode,
  Order,
  PaymentMethodHandler,
  RequestContext,
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
  createPayment: async () => ({
    amount: 0,
    state: 'Settled' as const,
    transactionId: 'pay-1',
    metadata: {},
  }),
  settlePayment: async () => ({ success: true }),
  createRefund: async () => ({
    state: 'Settled' as const,
    transactionId: 'refund-1',
    metadata: {},
  }),
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
});
