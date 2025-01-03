import { ErrorResult } from '@vendure/core';
import { SimpleGraphQLClient } from '@vendure/testing';
import { testPaymentMethod } from '../test-payment-method';
import { ResultOf, VariablesOf } from 'gql.tada';
import {
  AddItemToOrder,
  AddPaymentToOrder,
  ApplyCouponCode,
  SetBillingAddress,
  SetShippingAddress,
  SetShippingMethod,
  TransitionToState,
} from './operations';

/**
 * Set active order to have an address and a shippingmethod
 */
export async function setAddressAndShipping(
  shopClient: SimpleGraphQLClient,
  shippingMethodId: string | number,
  shippingAddress?: VariablesOf<typeof SetShippingAddress>,
  billingAddress?: VariablesOf<typeof SetBillingAddress>
): Promise<void> {
  const finalShippingAddress = shippingAddress ?? {
    input: {
      fullName: 'Martinho Pinelabio',
      streetLine1: 'Verzetsstraat',
      streetLine2: '12a',
      city: 'Liwwa',
      postalCode: '8923CP',
      countryCode: 'NL',
    },
  };

  await shopClient.query(SetShippingAddress, finalShippingAddress);

  if (billingAddress) {
    await shopClient.query(SetBillingAddress, billingAddress);
  }

  await shopClient.query(SetShippingMethod, {
    ids: [shippingMethodId],
  });
}

/**
 * Proceed the active order of current shopClient to proceed to ArrangingPayment
 */
export async function proceedToArrangingPayment(
  shopClient: SimpleGraphQLClient,
  shippingMethodId: string | number,
  shippingAddress: VariablesOf<typeof SetShippingAddress>,
  billingAddress?: VariablesOf<typeof SetBillingAddress>
): Promise<ResultOf<typeof TransitionToState>['transitionOrderToState']> {
  await setAddressAndShipping(
    shopClient,
    shippingMethodId,
    shippingAddress,
    billingAddress
  );
  const result = await shopClient.query(TransitionToState, {
    state: 'ArrangingPayment',
  });
  return result.transitionOrderToState;
}

/**
 * Add payment to active order by given code
 */
export async function addPaymentToOrder(
  shopClient: SimpleGraphQLClient,
  code: string
): Promise<ResultOf<typeof AddPaymentToOrder>['addPaymentToOrder']> {
  const { addPaymentToOrder } = await shopClient.query(AddPaymentToOrder, {
    input: {
      method: code,
      metadata: {
        baz: 'quux',
      },
    },
  });
  return addPaymentToOrder;
}

/**
 * Add item to active order
 */
export async function addItem(
  shopClient: SimpleGraphQLClient,
  variantId: string,
  quantity: number
): Promise<ResultOf<typeof AddItemToOrder>['addItemToOrder']> {
  const { addItemToOrder } = await shopClient.query(AddItemToOrder, {
    productVariantId: variantId,
    quantity,
  });

  return addItemToOrder;
}

export async function applyCouponCode(
  shopClient: SimpleGraphQLClient,
  couponCode: string
): Promise<ResultOf<typeof ApplyCouponCode>['applyCouponCode']> {
  const { applyCouponCode } = await shopClient.query(ApplyCouponCode, {
    couponCode,
  });

  return applyCouponCode;
}

/**
 * The non-error result of adding a payment to an order
 */
export type SettledOrder = Extract<
  ResultOf<typeof AddPaymentToOrder>['addPaymentToOrder'],
  { __typename?: 'Order' }
>;

export async function createSettledOrder(
  shopClient: SimpleGraphQLClient,
  shippingMethodId: string | number,
  authorizeFirst = true,
  variants: Array<{ id: string; quantity: number }> = [
    { id: 'T_1', quantity: 1 },
    { id: 'T_2', quantity: 2 },
  ],
  shippingAddress?: VariablesOf<typeof SetShippingAddress>,
  billingAddress?: VariablesOf<typeof SetBillingAddress>,
  paymentMethodCode: string = testPaymentMethod.code
): Promise<SettledOrder> {
  if (authorizeFirst) {
    await shopClient.asUserWithCredentials(
      'hayden.zieme12@hotmail.com',
      'test'
    );
  }
  for (const v of variants) {
    await addItem(shopClient, v.id, v.quantity);
  }
  let orderShippingAddress = shippingAddress;
  if (!orderShippingAddress) {
    orderShippingAddress = {
      input: {
        fullName: 'Martinho Pinelabio',
        streetLine1: 'Verzetsstraat',
        streetLine2: '12a',
        city: 'Liwwa',
        postalCode: '8923CP',
        countryCode: 'NL',
      },
    };
  }
  const res = await proceedToArrangingPayment(
    shopClient,
    shippingMethodId,
    orderShippingAddress,
    billingAddress
  );
  if ((res as ErrorResult)?.errorCode) {
    console.error(JSON.stringify(res));
    throw Error((res as ErrorResult).errorCode);
  }
  const order = await addPaymentToOrder(shopClient, paymentMethodCode);
  if ((order as ErrorResult).errorCode) {
    throw new Error(
      `Failed to create settled order: ${(order as ErrorResult).message}`
    );
  }
  return order as SettledOrder;
}
