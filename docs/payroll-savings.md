# Payroll Savings Integration

Internal-BAK Superadmin can enroll Pekarya/Loyalis directly, create a Koperasi login, and approve membership. Existing accounts are explicitly reused without replacing their password or role. Member numbers use `counters/memberNumber` through `allocateMemberNumber`; both apps share this allocator. Koperasi admin add/import uses an isolated Auth instance so the operator stays signed in.

Members with a `payrollSavings` policy receive contributions at Internal-BAK **Verifikasi & Kunci**. New Potong Gaji membership contributes Rp250,000 initial + Rp25,000 monthly by default, then only the monthly amount. Custom amounts remain supported. Subsidi Yayasan has no salary deduction or automatic savings credit. Initial settlement is explicit and independent of the balance.

`payrollLoanBridge` supports version 1 historical loans and version 2 loans plus savings. Version 2 preview freezes the member, policy and initial/monthly amounts into the hashed plan. `validate` checks it without writing. `apply` progresses loans, adds savings, settles the initial fee and writes savings history in one transaction. `payrollSavingsProgressions/{YYYY-MM}__{memberId}` stores the plan, source slip and receipt, so retries cannot double-credit or reuse a member on another slip. Balance changes are accumulated from the latest transactional balance; changes to contribution policy invalidate the plan. Version 1 is rejected for managed members from their effective month.

Scheduled and HTTP/manual legacy increments re-read membership in each transaction and skip every member with `payrollSavings`. The browser manual button uses authenticated `triggerLegacySavings`. Payroll history has `source: internal_bak_payroll`; both legacy rollback entrypoints reject those logs.

Cutover is November 2026 payroll. The scheduled batch dated 4 November belongs to October. The Internal-BAK migration preserves balances/logs and marks legacy registration fees settled. Deploy these compatible functions and hosting before Internal-BAK, then apply the reviewed dry-run migration before November drafts are prepared. No production member is changed by tests.

Tests: run `npm test` in `functions/`, and from this project's root run the Auth/Firestore/Functions emulator command documented in Internal-BAK `docs/features/koperasi.md`. The integration suite also invokes the sibling Internal-BAK checkout's locking saga, including an injected failure after the Koperasi credit but before the SAKU lock completes.
