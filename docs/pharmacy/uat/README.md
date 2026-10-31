# Pharmacy UAT kit (phases 2 to 7)

For the owner and the first pharmacy's staff, on a **trial business**, before launch. Plain-language scripts in English (`scenarios-en.md`) and Arabic (`scenarios-ar.md`), and one sign-off sheet (`sign-off.md`, bilingual). The invoice-photo (phase 5) acceptance on real paper has its own checklist: `../intake-uat.md`; this kit only touches it in scenario 15.

Spec row 8 asks for UAT "with a real pharmacy". Nothing in this kit has been run by a real pharmacy yet; it was written from the screens and the acceptance tests. Treat the expected results as a claim to check, not as proof.

## Before you start

1. A **trial** pharmacy business with two branches (needed for transfers and for "another branch" checks), created by a Super Admin in Studio. `Application(pharmacy)` must be ACTIVE (it ships DISABLED), and the business must have a `pharmacy` subscription in trial.
2. People, one per role, with their own sign-in: Owner, Pharmacist in charge (PIC), Pharmacist, Cashier, Stock clerk, Branch manager, Accountant. Give the Cashier, Pharmacist and Stock clerk branch 1 only.
3. In Settings: currency IQD (add USD only if the pharmacy will price in dollars), controlled-drug sales ON for scenario 5, credit sales ON for scenario 6. Both ship OFF.
4. Printer: whatever the pharmacy has (browser print). Silent printing and the cash drawer are NOT built; do not test them.
5. Use two browser windows (two people at once) for scenarios 3, 9 and 13.

## Seed-data note (no production data)

Use made-up data only. Never copy a real patient, prescription, customer phone number or the live pharmacy's catalogue into a trial business unless the owner decides to rehearse with the real catalogue on purpose, in a business created for the rehearsal.

Suggested seed (type it or import it as a CSV, columns as the catalog import expects):

| Item | Trade name | Form / strength | Level | Pack |
|---|---|---|---|---|
| P1 | Panadol Test | tablet 500 mg | OTC | strip of 10, box of 10 strips |
| P2 | Amoxil Test | capsule 500 mg | RX (prescription needed) | strip of 8 |
| P3 | Controlled Test | tablet 10 mg | RESTRICTED (controlled) | strip of 10 |
| P4 | Vitamin Test | tablet | OTC | bottle of 30 |

Prices (IQD): P1 tablet 100, strip 900. P2 strip 3000. P3 strip 5000. P4 bottle 4000. Customers: "Test Customer One" (limit 50,000 IQD), "Test Customer Two" (limit 0). Prescription: patient "Test Patient", doctor "Dr Test", licence "TEST-0001". Barcodes: make up 13-digit numbers, one starting with 0 to check the zero is kept.

The repository can also build a large synthetic catalogue for searching (`npx tsx prisma/seed-load-pharmacy.ts`, 50,000 products, only on a private database it checks); do not point it at a shared or hosted database.

## How to record results

For each step write PASS, FAIL or N/A in `sign-off.md`, with a short note and the person's initials. A FAIL on a step marked **(stop)** blocks launch until it is fixed. Write down anything that confuses a real user even when the step passes: that is the most valuable output.

## Scenarios at a glance

| # | Scenario | Who | Phase |
|---|---|---|---|
| 1 | Opening the pharmacy | Owner | 0-2 |
| 2 | Receive stock | PIC / Stock clerk | 2, 4 |
| 3 | Sell without a prescription | Cashier | 3 |
| 4 | Sell with a prescription (RX) | Pharmacist, Cashier | 3, 7 |
| 5 | Controlled drug | PIC, Pharmacist | 7 |
| 6 | Credit sale and payment | Pharmacist, Accountant | 7 |
| 7 | Return | Branch manager | 3 |
| 8 | Close the shift | Cashier, Manager | 3 |
| 9 | Transfer between branches | Branch manager, Stock clerk | 6 |
| 10 | Stock count | Stock clerk, PIC | 2 |
| 11 | Expiry and damaged stock | PIC | 2 |
| 12 | Reports and export | Accountant, Owner | 6 |
| 13 | The assistant | Pharmacist, Owner | 7 |
| 14 | Print labels and receipts | Cashier, Pharmacist | 3, 7 |
| 15 | Buying: orders, invoices, invoice by photo | Accountant, PIC | 4, 5 |
| 16 | Who can see what | All | all |
