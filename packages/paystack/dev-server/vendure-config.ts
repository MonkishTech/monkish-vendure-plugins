import { DefaultSearchPlugin, VendureConfig } from '@vendure/core';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import 'dotenv/config';
import path from 'path';
import { PaystackPlugin } from '../src';

const apiPort = process.env.API_PORT || 3000;

export const config: VendureConfig = {
  apiOptions: {
    port: +apiPort,
    adminApiPath: 'admin-api',
    shopApiPath: 'shop-api',
    shopApiPlayground: true,
    adminApiPlayground: true,
  },
  authOptions: {
    tokenMethod: ['bearer', 'cookie'],
    superadminCredentials: {
      identifier: 'superadmin',
      password: 'superadmin',
    },
  },
  dbConnectionOptions: {
    type: 'better-sqlite3',
    synchronize: true,
    migrations: [path.join(__dirname, '../migrations/*.+(js|ts)')],
    logging: false,
    database: path.join(__dirname, 'vendure.sqlite'),
  },
  paymentOptions: {
    paymentMethodHandlers: [],
  },
  plugins: [
    DefaultSearchPlugin.init({}),
    PaystackPlugin.init({
      secretKey: process.env.PAYSTACK_SECRET_KEY as string,
    }),
    AdminUiPlugin.init({
      port: 3002,
      route: 'admin',
      adminUiConfig: {
        apiPort: +apiPort,
        apiHost: 'http://localhost',
      },
    }),
  ],
};
