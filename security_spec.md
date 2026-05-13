# Security Spec

## Data Invariants
1. Users must have a valid role, and only admins can promote others to admins.
2. Products must have a valid id, price >= 0, cost >= 0.
3. Transactions can only be modified by the user who created them (userId matches) or an admin.
4. Partners must have valid id, name, type (CUSTOMER/SUPPLIER). Activity logs must always have correct reference to the current user making the request.

## Dirty Dozen Payloads
1. Product with negative price or negative cost.
2. Transaction modifying `userId` to a different user.
3. User attempting to assign themselves 'ADMIN' role on creation.
4. User updating a transaction with too many items (array size exhaustion).
5. Partner with a missing required type.
6. Product where name is 1.5MB of text (size limit bypass).
7. Injecting 1MB string into transaction ID.
8. Modifying `createdAt` during an update.
9. Activity Log with spoofed userId.
10. Creating a transaction with an invalid, non-map item in the `items` array.
11. Updating `permissions` string instead of map in user profile as a non-admin.
12. Attempt to shadow update a product with an unapproved key (e.g., `isVerified`).

## Test Runner
See `firestore.rules.test.ts` for full implementation.
