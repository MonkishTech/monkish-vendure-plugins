import nock from 'nock';
import path from 'path';
import { createHmac } from 'node:crypto';
import { rm } from 'node:fs/promises';
import gqlTag from 'graphql-tag';
import { InitialData } from '@vendure/core';
import {
  createTestEnvironment,
  registerInitializer,
  SimpleGraphQLClient,
  SqljsInitializer,
} from '@vendure/testing';
import { PaystackPlugin } from './paystack.plugin';
import {
  initialData,
  testConfig,
  addItem,
  getCustomerList,
  updateChannel,
  getActiveChannel,
} from '~utils';
import { PAYSTACK_API_URL } from './constants';
import { CreatePaystackPaymentIntent } from './graphql/operations';
import { PaystackPaymentIntent } from './types';

const TEST_SECRET_KEY = 'sk_test_1234567890';

const paystackTestInitialData: InitialData = {
  ...initialData,
  paymentMethods: [
    {
      name: 'Paystack',
      handler: {
        code: 'paystack',
        arguments: [{ name: 'secretKey', value: TEST_SECRET_KEY }],
      },
    },
  ],
};

export const mockInitializeTransactionResponse: Omit<
  PaystackPaymentIntent,
  '__typename'
> = {
  status: true,
  message: 'Authorization URL created',
  data: {
    authorization_url: 'https://checkout.paystack.com/3ni8kdavz62431k',
    access_code: '3ni8kdavz62431k',
    reference: 're4lyvq3s3',
  },
};

const TEST_DB_DIR = path.join(__dirname, '../__test_db__');
const API_PORT = 8000;

const ConfirmPaystackPayment = gqlTag`
  mutation ConfirmPaystackPayment($reference: String!) {
    confirmPaystackPayment(reference: $reference) {
      id
      code
      state
    }
  }
`;

const ActiveOrderForPaystack = gqlTag`
  query ActiveOrderForPaystack {
    activeOrder {
      code
      state
      totalWithTax
    }
    eligibleShippingMethods {
      id
    }
  }
`;

const OrderPayments = gqlTag`
  query OrderPayments($id: ID!) {
    order(id: $id) {
      state
      payments {
        amount
        state
        transactionId
        metadata
      }
    }
  }
`;

function mockVerify(
  reference: string,
  amount: number,
  metadata: Record<string, unknown>,
  id = 4242
) {
  nock(`${PAYSTACK_API_URL}`)
    .get(`/transaction/verify/${reference}`)
    .reply(200, {
      status: true,
      message: 'Verification successful',
      data: { id, status: 'success', amount, reference, metadata },
    });
}

describe('PaystackPlugin', () => {
  const { server, adminClient, shopClient } = createTestEnvironment({
    ...testConfig(API_PORT),
    plugins: [PaystackPlugin],
  });

  let customer: Awaited<
    ReturnType<typeof getCustomerList>
  >['customers']['items'][number];

  let started = false;

  async function arrangeArrangingPayment(
    shopClient: SimpleGraphQLClient
  ): Promise<{ code: string; totalWithTax: number }> {
    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    const before = await shopClient.query(ActiveOrderForPaystack);
    if (!before.activeOrder) {
      await addItem(shopClient, 1, 1);
    }
    await shopClient.query(gqlTag`
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
          ... on ErrorResult {
            errorCode
            message
          }
        }
      }
    `);
    const withMethods = await shopClient.query(ActiveOrderForPaystack);
    const shippingMethodId = withMethods.eligibleShippingMethods[0].id;
    await shopClient.query(
      gqlTag`
        mutation SetShipping($ids: [ID!]!) {
          setOrderShippingMethod(shippingMethodId: $ids) {
            ... on Order {
              id
            }
            ... on ErrorResult {
              errorCode
              message
            }
          }
        }
      `,
      { ids: [shippingMethodId] }
    );
    const transitioned = await shopClient.query(gqlTag`
      mutation {
        transitionOrderToState(state: "ArrangingPayment") {
          ... on Order {
            code
            state
            totalWithTax
          }
          ... on OrderStateTransitionError {
            errorCode
            message
          }
        }
      }
    `);
    const order = transitioned.transitionOrderToState;
    if (order.state !== 'ArrangingPayment') {
      throw new Error(order.message ?? 'Order did not reach ArrangingPayment');
    }
    return { code: order.code, totalWithTax: order.totalWithTax };
  }
  beforeAll(async () => {
    registerInitializer('sqljs', new SqljsInitializer(TEST_DB_DIR));

    await server.init({
      productsCsvPath: path.join(
        __dirname,
        '../../../utils/src/e2e/products.csv'
      ),
      initialData: paystackTestInitialData,
      customerCount: 2,
    });

    started = true;

    await adminClient.asSuperAdmin();

    customer = (await getCustomerList(adminClient, { take: 2 })).customers
      .items[0] as typeof customer;
    const activeChannel = await getActiveChannel(shopClient);

    await updateChannel(adminClient, {
      id: activeChannel.id,
      availableCurrencyCodes: ['USD', 'KES', 'GHS', 'NGN', 'JPY', 'ZAR'],
    });

    const { paymentMethods } = await adminClient.query(gqlTag`
      query PaymentMethods {
        paymentMethods {
          items {
            code
            handler {
              code
            }
          }
        }
      }
    `);
    const hasPaystackMethod = paymentMethods.items.some(
      (m: { handler: { code: string } }) => m.handler.code === 'paystack'
    );
    if (!hasPaystackMethod) {
      throw new Error('Expected Paystack payment method from initial data');
    }
  }, 60000);

  afterAll(async () => {
    await server.destroy();
    rm(TEST_DB_DIR, { recursive: true });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('can start successfully', () => {
    expect(started).toEqual(true);
    expect(customer).toBeDefined();
  });

  it('can initialize a transaction using the secret key from the payment method', async () => {
    nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize')
      .reply(200, mockInitializeTransactionResponse);

    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    await addItem(shopClient, 1, 1);

    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
        },
      }
    );

    expect(createPaystackPaymentIntent.__typename).toBe(
      'PaystackPaymentIntent'
    );
  });

  it('sends Paystack the Authorization header for the payment method secret key', async () => {
    nock(`${PAYSTACK_API_URL}`)
      .matchHeader('authorization', `Bearer ${TEST_SECRET_KEY}`)
      .post('/transaction/initialize')
      .reply(200, mockInitializeTransactionResponse);

    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    await addItem(shopClient, 1, 1);

    await shopClient.query(CreatePaystackPaymentIntent, {
      input: {
        callbackUrl: 'https://example.com',
      },
    });
  });

  it('sends paystackAmount to Paystack when set', async () => {
    const extra = 12345;
    nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize', (body) => body.amount === extra)
      .reply(200, mockInitializeTransactionResponse);

    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    await addItem(shopClient, 1, 1);

    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
          paystackAmount: extra,
        },
      }
    );

    expect(createPaystackPaymentIntent.__typename).toBe(
      'PaystackPaymentIntent'
    );
  });

  function captureInitialize() {
    let body: { amount?: number; metadata?: Record<string, unknown> } = {};
    nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize', (payload) => {
        body = payload;
        return true;
      })
      .reply(200, mockInitializeTransactionResponse);
    return () => body;
  }

  it('sends chargeAmount to Paystack and stores charge_amount', async () => {
    const sent = captureInitialize();
    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    await addItem(shopClient, 1, 1);
    const { activeOrder } = await shopClient.query(gqlTag`
      query {
        activeOrder {
          totalWithTax
        }
      }
    `);
    const chargeAmount = activeOrder.totalWithTax + 400;

    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
          chargeAmount,
        },
      }
    );

    expect(createPaystackPaymentIntent.__typename).toBe('PaystackPaymentIntent');
    expect(sent().amount).toBe(chargeAmount);
    expect(sent().metadata?.charge_amount).toBe(chargeAmount);
    expect(sent().metadata?.settlement_amount).toBeUndefined();
  });

  it('rejects chargeAmount and paystackAmount when they differ', async () => {
    const scope = nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize')
      .reply(200, mockInitializeTransactionResponse);

    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
          chargeAmount: 100,
          paystackAmount: 200,
        },
      }
    );

    expect(createPaystackPaymentIntent.__typename).toBe(
      'PaystackPaymentIntentError'
    );
    expect(createPaystackPaymentIntent.message).toBe(
      'chargeAmount and paystackAmount must match.'
    );
    expect(scope.isDone()).toBe(false);
    nock.cleanAll();
  });

  it('rejects a settlementAmount above the outstanding balance without calling Paystack', async () => {
    const scope = nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize')
      .reply(200, mockInitializeTransactionResponse);

    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
          settlementAmount: 2_000_000_000,
        },
      }
    );

    expect(createPaystackPaymentIntent.__typename).toBe(
      'PaystackPaymentIntentError'
    );
    expect(createPaystackPaymentIntent.message).toBe(
      'settlementAmount cannot exceed the outstanding balance.'
    );
    expect(scope.isDone()).toBe(false);
    nock.cleanAll();
  });

  it('rejects a chargeAmount below the settlement amount without calling Paystack', async () => {
    const scope = nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize')
      .reply(200, mockInitializeTransactionResponse);

    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
          settlementAmount: 100,
          chargeAmount: 50,
        },
      }
    );

    expect(createPaystackPaymentIntent.__typename).toBe(
      'PaystackPaymentIntentError'
    );
    expect(createPaystackPaymentIntent.message).toBe(
      'chargeAmount cannot be less than the settlement amount.'
    );
    expect(scope.isDone()).toBe(false);
    nock.cleanAll();
  });

  it('can gracefully handle a failed transaction initialization', async () => {
    nock(`${PAYSTACK_API_URL}`).post('/transaction/initialize').reply(400, {
      message: 'Invalid request',
    });

    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    await addItem(shopClient, 1, 1);

    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
        },
      }
    );

    expect(createPaystackPaymentIntent.__typename).toBe(
      'PaystackPaymentIntentError'
    );
  });

  it('should reject an unsupported currency', async () => {
    await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
    await addItem(shopClient, 1, 1, { currencyCode: 'JPY' });

    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
        },
      },
      {
        currencyCode: 'JPY',
      }
    );

    expect(createPaystackPaymentIntent.__typename).toBe(
      'PaystackPaymentIntentError'
    );
  });

  it('rejects webhook calls with an invalid signature', async () => {
    const body = { event: 'charge.success', data: {} };
    const bodyString = JSON.stringify(body);
    const res = await shopClient.fetch(
      `http://localhost:${API_PORT}/payments/paystack`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-paystack-signature': 'deadbeef',
        },
        body: bodyString,
      }
    );
    expect(res.status).toBe(400);
  });

  it('accepts webhook calls with a valid signature for a configured secret key', async () => {
    const body = {
      event: 'charge.success',
      data: { reference: 'noop', id: 1 },
    };
    const bodyString = JSON.stringify(body);
    const sig = createHmac('sha512', TEST_SECRET_KEY)
      .update(bodyString)
      .digest('hex');

    const res = await shopClient.fetch(
      `http://localhost:${API_PORT}/payments/paystack`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-paystack-signature': sig,
        },
        body: bodyString,
      }
    );
    expect(res.status).toBe(200);
  });

  it('records the outstanding balance when chargeAmount is higher', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const chargeAmount = order.totalWithTax + 400;
    nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize')
      .reply(200, mockInitializeTransactionResponse);
    await shopClient.query(CreatePaystackPaymentIntent, {
      input: { callbackUrl: 'https://example.com', chargeAmount },
    });
    mockVerify('re4lyvq3s3', chargeAmount, {
      order_code: order.code,
      charge_amount: chargeAmount,
    });

    const { confirmPaystackPayment } = await shopClient.query(
      ConfirmPaystackPayment,
      { reference: 're4lyvq3s3' }
    );

    expect(confirmPaystackPayment.state).toBe('PaymentSettled');
    const { order: settled } = await adminClient.query(OrderPayments, {
      id: confirmPaystackPayment.id,
    });
    expect(settled.payments).toHaveLength(1);
    expect(settled.payments[0].amount).toBe(order.totalWithTax);
    expect(settled.payments[0].metadata.chargeAmount).toBe(chargeAmount);
  });

  it('records the outstanding balance when deprecated paystackAmount is higher', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const paystackAmount = order.totalWithTax + 400;
    nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize')
      .reply(200, {
        ...mockInitializeTransactionResponse,
        data: {
          ...mockInitializeTransactionResponse.data,
          reference: 'fee-alias-ref',
        },
      });
    await shopClient.query(CreatePaystackPaymentIntent, {
      input: { callbackUrl: 'https://example.com', paystackAmount },
    });
    mockVerify(
      'fee-alias-ref',
      paystackAmount,
      {
        order_code: order.code,
        charge_amount: paystackAmount,
      },
      4343
    );

    const { confirmPaystackPayment } = await shopClient.query(
      ConfirmPaystackPayment,
      { reference: 'fee-alias-ref' }
    );

    expect(confirmPaystackPayment.state).toBe('PaymentSettled');
    const { order: settled } = await adminClient.query(OrderPayments, {
      id: confirmPaystackPayment.id,
    });
    expect(settled.payments[0].amount).toBe(order.totalWithTax);
    expect(settled.payments[0].metadata.chargeAmount).toBe(paystackAmount);
  });

  it('records an explicit settlementAmount below the balance', async () => {
    const order = await arrangeArrangingPayment(shopClient);
    const settlementAmount = Math.min(100, order.totalWithTax - 1);
    nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize', (body) => {
        return (
          body.amount === settlementAmount &&
          body.metadata.settlement_amount === settlementAmount &&
          body.metadata.charge_amount === settlementAmount
        );
      })
      .reply(200, {
        ...mockInitializeTransactionResponse,
        data: {
          ...mockInitializeTransactionResponse.data,
          reference: 'deposit-ref',
        },
      });

    const intent = await shopClient.query(CreatePaystackPaymentIntent, {
      input: {
        callbackUrl: 'https://example.com',
        settlementAmount,
      },
    });
    expect(intent.createPaystackPaymentIntent.__typename).toBe(
      'PaystackPaymentIntent'
    );

    mockVerify(
      'deposit-ref',
      settlementAmount,
      {
        order_code: order.code,
        charge_amount: settlementAmount,
        settlement_amount: settlementAmount,
      },
      5151
    );

    const { confirmPaystackPayment } = await shopClient.query(
      ConfirmPaystackPayment,
      { reference: 'deposit-ref' }
    );

    expect(confirmPaystackPayment.state).not.toBe('PaymentSettled');
    const { order: settled } = await adminClient.query(OrderPayments, {
      id: confirmPaystackPayment.id,
    });
    expect(settled.payments).toHaveLength(1);
    expect(settled.payments[0].amount).toBe(settlementAmount);
    expect(settled.state).not.toBe('PaymentSettled');

    await shopClient.query(gqlTag`
      mutation {
        transitionOrderToState(state: "Cancelled") {
          ... on Order {
            state
          }
        }
      }
    `);
  });
});
