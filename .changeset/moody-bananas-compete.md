---
'@monkish/vendure-paystack-plugin': patch
---

Allow a Paystack charge to differ from the settled payment. Pass `settlementAmount` for a partial payment, or a higher `chargeAmount` when Paystack should collect more than the outstanding balance. `paystackAmount` remains as a deprecated alias of `chargeAmount`.
