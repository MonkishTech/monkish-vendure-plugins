import nock from 'nock';
import path from 'path';
import { createTestEnvironment } from '@vendure/testing';
import { PaystackPlugin } from './paystack.plugin';
import {
  initialData,
  testConfig,
  addItem,
  getCustomerList,
  updateChannel,
  getActiveChannel,
} from '@workspace/test-utils';
import { PAYSTACK_API_URL } from '../src/constants';
import { CreatePaystackPaymentIntent } from '../src/graphql/operations';
import { PaystackPaymentIntent } from './types';

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

describe('PaystackPlugin', () => {
  const { server, adminClient, shopClient } = createTestEnvironment({
    ...testConfig(8000),
    plugins: [
      PaystackPlugin.init({
        secretKey: 'sk_test_1234567890',
      }),
    ],
  });

  let customer: Awaited<
    ReturnType<typeof getCustomerList>
  >['customers']['items'][number];

  let started = false;

  beforeAll(async () => {
    await server.init({
      productsCsvPath: path.join(
        __dirname,
        '../../test-utils/src/e2e/products.csv'
      ),
      initialData: initialData,
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
  }, 60000);

  afterAll(async () => {
    await server.destroy();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('can start successfully', () => {
    expect(started).toEqual(true);
    expect(customer).toBeDefined();
  });

  it('can initialize a transaction', async () => {
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
});
