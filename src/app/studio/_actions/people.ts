'use server';

import * as people from '@/server/studio/actions/people';
import { invoke, invokePublic, invokeQuery } from '@/server/studio/framework/invoke';
import * as invitations from '@/server/studio/public-actions/invitations';
import * as peopleQueries from '@/server/studio/queries/people';

export async function inviteStaff(input: unknown) {
  return invoke(people.inviteStaff, input);
}

export async function inviteOwner(input: unknown) {
  return invoke(people.inviteOwner, input);
}

export async function revokeInvitation(input: unknown) {
  return invoke(people.revokeInvitation, input);
}

export async function resendInvitation(input: unknown) {
  return invoke(people.resendInvitation, input);
}

export async function assignDesigner(input: unknown) {
  return invoke(people.assignDesigner, input);
}

export async function createTillStaff(input: unknown) {
  return invoke(people.createTillStaff, input);
}

export async function unassignMember(input: unknown) {
  return invoke(people.unassignMember, input);
}

export async function deactivateUser(input: unknown) {
  return invoke(people.deactivateUser, input);
}

export async function deleteUser(input: unknown) {
  return invoke(people.deleteUser, input);
}

export async function reactivateUser(input: unknown) {
  return invoke(people.reactivateUser, input);
}

export async function changeUserEmail(input: unknown) {
  return invoke(people.changeUserEmail, input);
}

export async function setPermissionPolicy(input: unknown) {
  return invoke(people.setPermissionPolicy, input);
}

export async function listPeople(input: unknown) {
  return invokeQuery(peopleQueries.listPeople, input);
}

export async function listInvitations(input: unknown) {
  return invokeQuery(peopleQueries.listInvitations, input);
}

export async function restaurantMembers(input: unknown) {
  return invokeQuery(peopleQueries.restaurantMembers, input);
}

// For a person who may not have an account yet: opening an invitation link, and accepting.
export async function getInvitation(input: unknown) {
  return invokePublic(invitations.getInvitation, input);
}

export async function acceptInvitationAction(input: unknown) {
  return invokePublic(invitations.acceptInvitationAction, input);
}
