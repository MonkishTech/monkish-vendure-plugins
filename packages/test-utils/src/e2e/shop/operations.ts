import { shopGraphQL } from '../../generated/types';

const OrderFragment = shopGraphQL(`
  fragment OrderFields on Order @_unmask {
    id
    code
    state
    active
    total
    shipping
    totalWithTax
    shippingWithTax
    shippingAddress {
      fullName
      company
      streetLine1
      streetLine2
      city
      postalCode
      country
    }
    billingAddress {
      fullName
      company
      streetLine1
      streetLine2
      city
      postalCode
      country
    }
    customer {
      id
      firstName
      lastName
      emailAddress
    }
    lines {
      id
      quantity
      productVariant {
        id
      }
      discounts {
        adjustmentSource
        amount
        amountWithTax
        description
        type
      }
    }
    couponCodes
  }
`);

export const AddItemToOrder = shopGraphQL(
  `
    mutation AddItemToOrder($productVariantId: ID!, $quantity: Int!) {
      addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
        ... on Order {
          ...OrderFields
        }
        ... on ErrorResult {
          errorCode
          message
        }
      }
    }
  `,
  [OrderFragment]
);

export const ApplyCouponCode = shopGraphQL(
  `
    mutation ApplyCouponCode($couponCode: String!) {
      applyCouponCode(couponCode: $couponCode) {
        ... on Order {
          ...OrderFields
        }
        ... on ErrorResult {
          errorCode
          message
        }
      }
    }
  `,
  [OrderFragment]
);

export const SetShippingAddress = shopGraphQL(
  `
    mutation SetShippingAddress($input: CreateAddressInput!) {
      setOrderShippingAddress(input: $input) {
        ... on Order {
          ...OrderFields
        }
      }
    }
  `,
  [OrderFragment]
);

export const SetBillingAddress = shopGraphQL(
  `
    mutation SetBillingAddress($input: CreateAddressInput!) {
      setOrderBillingAddress(input: $input) {
        ... on Order {
          ...OrderFields
        }
      }
    }
  `,
  [OrderFragment]
);

export const SetShippingMethod = shopGraphQL(
  `
    mutation SetShippingMethod($ids: [ID!]!) {
      setOrderShippingMethod(shippingMethodId: $ids) {
        ... on ErrorResult {
          errorCode
          message
        }
      }
    }
  `
);

export const TransitionToState = shopGraphQL(
  `
    mutation TransitionToState($state: String!) {
      transitionOrderToState(state: $state) {
        ... on OrderStateTransitionError {
          errorCode
          message
          transitionError
        }
      }
    }
  `
);

export const AddPaymentToOrder = shopGraphQL(
  `
    mutation AddPaymentToOrder($input: PaymentInput!) {
      addPaymentToOrder(input: $input) {
        ... on Order {
          ...OrderFields
        }
        ... on ErrorResult {
          errorCode
          message
        }
      }
    }
  `,
  [OrderFragment]
);
