import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaystackPlugin } from '../src';
import path from 'path';
import nock from 'nock';
import { initialData, testConfig } from '@workspace/utils';
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

  beforeAll(async () => {
    await server.init({
      productsCsvPath: path.join(
        __dirname,
        '../../../libs/utils/src/e2e/products.csv'
      ),
      initialData: initialData,
      customerCount: 2,
    });
    await adminClient.asSuperAdmin();
  }, 60000);

  afterAll(async () => {
    await server.destroy();
  });

  it('can initialize a transaction', async () => {
    nock(`${PAYSTACK_API_URL}`)
      .post('/transaction/initialize')
      .reply(200, mockInitializeTransactionResponse);

    const { createPaystackPaymentIntent } = await shopClient.query(
      CreatePaystackPaymentIntent,
      {
        input: {
          callbackUrl: 'https://example.com',
        },
      }
    );
    console.log(JSON.stringify(createPaystackPaymentIntent, null, 2));
    expect(true).toBeTruthy();
  });
});
