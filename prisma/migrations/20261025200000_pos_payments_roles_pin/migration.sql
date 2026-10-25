-- CreateTable
CREATE TABLE "PosPaymentReversal" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PosPaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "shiftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPaymentReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSharedDevice" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PosSharedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPinAttempt" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPinAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosPaymentReversal_paymentId_key" ON "PosPaymentReversal"("paymentId");

-- CreateIndex
CREATE INDEX "PosPaymentReversal_restaurantId_createdAt_idx" ON "PosPaymentReversal"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "PosPaymentReversal_shiftId_idx" ON "PosPaymentReversal"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "PosSharedDevice_tokenHash_key" ON "PosSharedDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "PosSharedDevice_restaurantId_idx" ON "PosSharedDevice"("restaurantId");

-- CreateIndex
CREATE INDEX "PosPinAttempt_deviceId_at_idx" ON "PosPinAttempt"("deviceId", "at");

-- CreateIndex
CREATE INDEX "PosPinAttempt_staffId_at_idx" ON "PosPinAttempt"("staffId", "at");

-- AddForeignKey
ALTER TABLE "PosPaymentReversal" ADD CONSTRAINT "PosPaymentReversal_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPaymentReversal" ADD CONSTRAINT "PosPaymentReversal_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PosPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPaymentReversal" ADD CONSTRAINT "PosPaymentReversal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPaymentReversal" ADD CONSTRAINT "PosPaymentReversal_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSharedDevice" ADD CONSTRAINT "PosSharedDevice_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPinAttempt" ADD CONSTRAINT "PosPinAttempt_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
