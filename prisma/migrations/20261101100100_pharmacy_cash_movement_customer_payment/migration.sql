-- The previous migration added CUSTOMER_PAYMENT to PhCashMovementType; a new enum value can be used only after the transaction that
-- adds it, so the sign rule of the drawer is replaced here. The new rule is the old one plus CUSTOMER_PAYMENT (money in, positive).
-- Replaced in one statement, so no movement is ever written between the two. Rows already there satisfy it (it only widens).
ALTER TABLE "PhCashMovement" DROP CONSTRAINT "PhCashMovement_amount_sign", ADD CONSTRAINT "PhCashMovement_amount_sign" CHECK (
  ("type" IN ('FLOAT_OPEN', 'SALE_CASH', 'PAID_IN', 'CUSTOMER_PAYMENT') AND "amountMinor" > 0)
  OR ("type" IN ('CHANGE_OUT', 'REFUND_CASH', 'PAID_OUT') AND "amountMinor" < 0)
);
