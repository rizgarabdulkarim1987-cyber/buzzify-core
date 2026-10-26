-- A session made by PIN sign-in remembers its shared device and restaurant.
ALTER TABLE "session" ADD COLUMN "posDeviceId" TEXT,
ADD COLUMN "posRestaurantId" TEXT;

CREATE INDEX "session_posDeviceId_idx" ON "session"("posDeviceId");
