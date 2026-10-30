'use server';

import * as controlledSettings from '@/server/pharmacy/actions/controlled-settings';
import * as creditSettings from '@/server/pharmacy/actions/credit-settings';
import * as customers from '@/server/pharmacy/actions/customers';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as customerQueries from '@/server/pharmacy/queries/customers';

// The customer, credit and settings screens' Server Actions. `invokePh` puts in the place the person chose.

export async function listCustomers(input: unknown) {
  return invokePhQuery(customerQueries.list, input);
}

export async function getCustomer(input: unknown) {
  return invokePhQuery(customerQueries.get, input);
}

export async function customerStatement(input: unknown) {
  return invokePhQuery(customerQueries.statement, input);
}

export async function createCustomer(input: unknown) {
  return invokePh(customers.create, input);
}

export async function updateCustomer(input: unknown) {
  return invokePh(customers.update, input);
}

export async function archiveCustomer(input: unknown) {
  return invokePh(customers.archive, input);
}

export async function recordCustomerPayment(input: unknown) {
  return invokePh(customers.pay, input);
}

export async function reverseCustomerPayment(input: unknown) {
  return invokePh(customers.reverse, input);
}

export async function setControlledSettings(input: unknown) {
  return invokePh(controlledSettings.set, input);
}

export async function setCreditSettings(input: unknown) {
  return invokePh(creditSettings.set, input);
}
