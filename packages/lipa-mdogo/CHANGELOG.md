# @monkish/vendure-lipa-mdogo-plugin

## 0.0.3

### Patch Changes

- 2a38300: Store lipa mdogo plan deadlines as `Date` so the plugin can boot on Postgres.
  Give the lipa mdogo variant fields English titles in the admin product editor.

## 0.0.2

### Patch Changes

- 0893104: A lipa mdogo plan starts only for one admin-enabled variant. The admin sets the per-unit deposit and the deadline. The shopper no longer sends `minimumPayment` or `deadline`, and `minimumDue` is the unpaid deposit, then 1 minor unit.
