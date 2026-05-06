import nock from 'nock';
import path from 'path';
import { createHmac } from 'node:crypto';
import { rm } from 'node:fs/promises';
import gqlTag from 'graphql-tag';
import { InitialData } from '@vendure/core';
import {
  createTestEnvironment,
  registerInitializer,
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

describe('PaystackPlugin', () => {
  const { server, adminClient, shopClient } = createTestEnvironment({
    ...testConfig(API_PORT),
    plugins: [PaystackPlugin],
  });

  let customer: Awaited<
    ReturnType<typeof getCustomerList>
  >['customers']['items'][number];

  let started = false;
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
});
