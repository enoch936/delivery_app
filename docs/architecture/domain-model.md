# Initial domain model

```text
Country ──< City ──< ServiceZone
User ──< UserRoleAssignment
User ──< CustomerAddress
Merchant ──< Store ──< Catalog ──< Product ──< ProductVariant
User (courier) ──< CourierProfile ──< CourierVerification
Customer ──< Cart ──< CartLine
Order ──< OrderLine
Order ──< OrderEvent
Order ──0..1 DeliveryAssignment >── Courier
Order ──< PaymentAttempt ──< LedgerEntry
Order ──< SupportCase
Privileged action ──< AuditLog
```

The initial migration establishes the market configuration, users, roles, service zones, and audit spine. Catalogue, orders, assignment, payment and ledger tables are added only alongside their implemented domain workflows and transaction tests.

## Core invariants

- Financial amounts are integer minor units and every sum must share currency.
- The server owns quote calculation, stock validation, fees, discounts, and payment state.
- An order's state moves through an allowed transition only; it never regresses for customer-visible state.
- One delivery assignment can be active per delivery; assignment races must be resolved transactionally.
- A role never supplies access by itself without a scoped policy (organization, merchant, order, or operational need).
- Mutating external calls and webhooks are idempotent and auditable.
