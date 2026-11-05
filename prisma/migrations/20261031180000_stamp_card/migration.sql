-- The stamp card: the restaurant's switch, the guest's card, and what each paid order earned or spent.
ALTER TABLE "PosSettings" ADD COLUMN "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PosSettings" ADD COLUMN "loyaltyStampsRequired" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "PosSettings" ADD COLUMN "loyaltyReward" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PosSettings" ADD CONSTRAINT "PosSettings_loyaltyStampsRequired_check" CHECK ("loyaltyStampsRequired" BETWEEN 3 AND 20);

ALTER TABLE "PosCustomerOrder" ADD COLUMN "cardKey" TEXT;
ALTER TABLE "PosCustomerOrder" ADD COLUMN "redeemReward" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PosLoyaltyCard" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "cardKey" TEXT NOT NULL,
    "stamps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PosLoyaltyCard_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PosLoyaltyCard_stamps_check" CHECK ("stamps" >= 0)
);
CREATE UNIQUE INDEX "PosLoyaltyCard_restaurantId_cardKey_key" ON "PosLoyaltyCard"("restaurantId", "cardKey");
ALTER TABLE "PosLoyaltyCard" ADD CONSTRAINT "PosLoyaltyCard_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PosLoyaltyStamp" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "cardKey" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosLoyaltyStamp_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PosLoyaltyStamp_kind_check" CHECK ("kind" IN ('EARN', 'SPEND'))
);
CREATE UNIQUE INDEX "PosLoyaltyStamp_restaurantId_orderId_cardKey_kind_key" ON "PosLoyaltyStamp"("restaurantId", "orderId", "cardKey", "kind");
ALTER TABLE "PosLoyaltyStamp" ADD CONSTRAINT "PosLoyaltyStamp_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
