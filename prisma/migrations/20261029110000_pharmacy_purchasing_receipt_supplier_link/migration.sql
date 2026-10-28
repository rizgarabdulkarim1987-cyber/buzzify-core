-- A receipt answering an order is for the order's supplier as well as its branch: a second composite key, beside the first.
-- CreateIndex
CREATE UNIQUE INDEX "PhPurchaseOrder_restaurantId_id_branchId_supplierId_key" ON "PhPurchaseOrder"("restaurantId", "id", "branchId", "supplierId");
-- AddForeignKey
ALTER TABLE "PhReceipt" ADD CONSTRAINT "PhReceipt_restaurantId_purchaseOrderId_branchId_supplierId_fkey" FOREIGN KEY ("restaurantId", "purchaseOrderId", "branchId", "supplierId") REFERENCES "PhPurchaseOrder"("restaurantId", "id", "branchId", "supplierId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- An invoice falls due on or after its own date.
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_due_not_before_invoice" CHECK ("dueDate" >= "invoiceDate");
