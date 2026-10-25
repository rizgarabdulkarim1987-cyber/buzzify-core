import { baghdadDayOf } from '@/lib/baghdad';
import type { DailyReport } from '@/server/pos/report';
import type { ItemRow } from '@/server/pos/inventory';
import type { PurchaseListRow, SupplierRow } from '@/server/pos/purchases';
import type { RangeReport } from '@/server/pos/range-report';
import { redactPhones } from './untrusted';

/**
 * What the model sees of each service's answer. Every list carries a `count`. Ids are left out (the model never needs one),
 * and so are supplier phones and notes, free staff text (cancel reasons) and, unless the reader may see costs, every cost.
 */

export function dailyReportShape(report: DailyReport) {
  return {
    day: report.day,
    count: report.shifts.length,
    shifts: report.shifts.map((shift) => ({
      cashierName: shift.cashierName,
      open: shift.shift.closedAt === null,
      grossSales: shift.grossSales,
      discountsTotal: shift.discountsTotal,
      refundsTotal: shift.refundsTotal,
      refundCount: Object.values(shift.refundsByMethod).reduce((sum, m) => sum + m.count, 0),
      netSales: shift.netSales,
      cancelledOrders: shift.cancelledOrders,
      cancelledLines: shift.cancelledLines,
      expensesTotal: shift.expenses.reduce((sum, e) => sum + e.amount, 0),
      expectedCash: shift.expectedCash,
      countedCash: shift.countedCash,
      difference: shift.difference,
    })),
    totals: {
      grossSales: report.totals.grossSales,
      discountsTotal: report.totals.discountsTotal,
      refundsTotal: report.totals.refundsTotal,
      netSales: report.totals.netSales,
      cancelledOrders: report.totals.cancelledOrders,
      cancelledLines: report.totals.cancelledLines,
      expensesTotal: report.totals.expensesTotal,
      differenceTotal: report.totals.differenceTotal,
    },
    outsideShiftCancels: report.outsideShifts ? report.outsideShifts.cancelledOrders + report.outsideShifts.cancelledLines : 0,
  };
}

export function rangeReportShape(report: RangeReport) {
  const { totals } = report;
  return {
    from: report.from,
    to: report.to,
    count: report.days.length,
    totals: {
      grossSales: totals.grossSales,
      refundsTotal: totals.refundsTotal,
      netSales: totals.netSales,
      purchasesTotal: totals.purchasesTotal,
      purchaseCount: totals.purchaseCount,
      purchasesUnpaid: totals.purchasesUnpaid,
      wasteCost: totals.wasteCost,
      coveredSales: totals.coverage.coveredSales,
      coveredMargin: totals.coverage.coveredMargin,
      unknownCostLines: totals.coverage.uncoveredLines,
    },
    days: report.days.map((d) => ({ day: d.day, grossSales: d.grossSales, netSales: d.netSales, purchasesTotal: d.purchasesTotal })),
    topProducts: [...report.products]
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 20)
      .map((p) => ({ name: p.name, quantity: p.quantity, sales: p.sales, ...(p.cost === null ? {} : { cost: p.cost }), ...(p.margin === null ? {} : { margin: p.margin }), status: p.status })),
  };
}

export function itemsShape(items: ItemRow[]) {
  return {
    count: items.length,
    items: items.map((item) => ({
      name: item.name,
      unit: item.unit,
      onHand: item.onHand,
      reorderLevel: item.reorderLevel,
      state: item.state,
      ...(item.lastCost ? { lastCost: { amount: item.lastCost.amount, quantity: item.lastCost.quantity } } : {}),
    })),
  };
}

export function suppliersShape(suppliers: SupplierRow[]) {
  return { count: suppliers.length, suppliers: suppliers.map((s) => ({ name: s.name, active: s.active })) };
}

export function invoicesShape(rows: PurchaseListRow[]) {
  return { count: rows.length, invoices: rows.map((r) => ({ supplierName: r.supplierName, invoiceDay: r.invoiceDay, number: r.number, total: r.total, paid: r.paid, voided: r.voided, lines: r.lines })) };
}

export function complaintsShape(rows: { id: string; status: string; category: string | null; excerpt: string; createdAt: Date; tableNumber: number | null }[], aiCategory: Map<string, string | null>) {
  return {
    count: rows.length,
    complaints: rows.map((r) => ({
      status: r.status,
      category: r.category,
      aiCategory: aiCategory.get(r.id) ?? null,
      excerpt: redactPhones(r.excerpt),
      createdAt: baghdadDayOf(r.createdAt),
      tableNumber: r.tableNumber,
    })),
  };
}
