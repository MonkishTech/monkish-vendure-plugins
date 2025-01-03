import { PaystackPaymentIntent } from '../src/types';

export const mockInitializeTransactionResponse: PaystackPaymentIntent = {
  status: true,
  message: 'Authorization URL created',
  data: {
    authorization_url: 'https://checkout.paystack.com/3ni8kdavz62431k',
    access_code: '3ni8kdavz62431k',
    reference: 're4lyvq3s3',
  },
};
