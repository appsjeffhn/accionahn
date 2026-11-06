"use server";

import { revalidatePath } from "next/cache";
import { field } from "@/lib/catalog/form";
import { parseClosedDateForm, parseResourceForm, parseWorkingHoursForm } from "@/lib/store/calendar-form";
import {
  deleteClosedDate,
  deleteResource,
  deleteWorkingHours,
  saveClosedDate,
  saveResource,
  saveWorkingHours,
} from "@/lib/store/setup";
import { failed, saved, type FormState } from "../form-state";
import { failure, panelSession } from "../session";

// Tenant from the session; resource and product ids from the form must belong to it
// (the composite foreign keys refuse anything else -> ForbiddenError).

async function run(write: () => Promise<void>): Promise<FormState> {
  try {
    await write();
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/calendar");
  return saved();
}

export async function saveResourceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  const parsed = parseResourceForm(fd);
  if (!parsed.ok) return failed(parsed.errors);
  return run(() => saveResource(session, parsed.value));
}

// Fails with InUseError when bookings reference the resource: deactivate it instead.
export async function deleteResourceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  return run(() => deleteResource(session, field(fd, "id")));
}

export async function saveHoursAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  const parsed = parseWorkingHoursForm(fd);
  if (!parsed.ok) return failed(parsed.errors);
  return run(() => saveWorkingHours(session, parsed.value));
}

export async function deleteHoursAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  return run(() => deleteWorkingHours(session, field(fd, "id")));
}

export async function saveClosedDateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  const parsed = parseClosedDateForm(fd);
  if (!parsed.ok) return failed(parsed.errors);
  return run(() => saveClosedDate(session, parsed.value));
}

export async function deleteClosedDateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  return run(() => deleteClosedDate(session, field(fd, "id")));
}
