import nock from 'nock';
import path from 'path';
import { createTestEnvironment } from '@vendure/testing';
import { PaystackPlugin } from '../src';
import {
  initialData,
  testConfig,
  addItem,
  getCustomerList,
} from '@workspace/test-utils';
import { PAYSTACK_API_URL } from '../src/constants';
import { mockInitializeTransactionResponse } from './mocks';
import { CreatePaystackPaymentIntent } from '../src/graphql/operations';

describe('PaystackPlugin', () => {
  const { server, adminClient, shopClient } = createTestEnvironment({
    ...testConfig(8000),
    plugins: [
      PaystackPlugin.init({
        secretKey: 'sk_test_1234567890',
      }),
    ],
  });

  let customers: Awaited<
    ReturnType<typeof getCustomerList>
  >['customers']['items'];
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
    customers = (await getCustomerList(adminClient, { take: 2 })).customers
      .items;
  }, 60000);

  afterAll(async () => {
    await server.destroy();
  });

  it('can start successfully', () => {
    expect(started).toEqual(true);
    expect(customers).toHaveLength(2);
  });

  it('can initialize a transaction', async () => {
    nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize')
      .reply(200, mockInitializeTransactionResponse);

    await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
    await addItem(shopClient, 1, 1);

    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
        },
      }
    );
    // console.log(JSON.stringify(createPaystackPaymentIntent, null, 2));
    // expect(true).toBe(true);
  });
});
