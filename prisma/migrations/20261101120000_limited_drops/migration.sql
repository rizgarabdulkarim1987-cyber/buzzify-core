-- Limited drops: a dish on the menu only between two instants.
ALTER TABLE "Product" ADD COLUMN "dropStartsAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN "dropEndsAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD CONSTRAINT "Product_drop_window_check" CHECK (
  ("dropStartsAt" IS NULL AND "dropEndsAt" IS NULL) OR ("dropStartsAt" IS NOT NULL AND "dropEndsAt" IS NOT NULL AND "dropEndsAt" > "dropStartsAt")
);
