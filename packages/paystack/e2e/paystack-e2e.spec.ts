import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaystackPlugin } from '../src';
import path from 'path';

import { initialData, testConfig } from '@workspace/utils';

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

  it('works', () => {
    expect(true).toBe(true);
  });
});
