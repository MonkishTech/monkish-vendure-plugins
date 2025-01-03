import { graphql } from '../generated/types';

const OrderFragment = graphql(`
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

export const AddItemToOrder = graphql(
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

export const ApplyCouponCode = graphql(
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

export const SetShippingAddress = graphql(
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

export const SetBillingAddress = graphql(
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

export const SetShippingMethod = graphql(
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

export const TransitionToState = graphql(
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

export const AddPaymentToOrder = graphql(
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
