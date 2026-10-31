-- A supplier remembers the hash of the request that created it, so a late retry of that request is a replay even after the supplier was edited. Null for rows made before; they are compared by their stored fields.
ALTER TABLE "PhSupplier" ADD COLUMN "payloadHash" TEXT;
