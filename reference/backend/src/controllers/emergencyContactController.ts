import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { toEmergencyContact } from '../utils/serializers'
import {
  createEmergencyContact,
  deleteEmergencyContact,
  listEmergencyContacts,
  setPrimaryEmergencyContact,
  updateEmergencyContact
} from '../services/emergencyContactService'

function contactId(req: { params: Record<string, unknown> }): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, 'Contact id is required.', { code: 'VALIDATION_ERROR' })
  return id
}

export const listEmergencyContactsController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const contacts = await listEmergencyContacts(userId)
  res.json({ success: true, emergencyContacts: contacts.map(toEmergencyContact) })
}

export const createEmergencyContactController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const contact = await createEmergencyContact(userId, req.body)
  res.status(201).json({ success: true, emergencyContact: toEmergencyContact(contact) })
}

export const updateEmergencyContactController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const contact = await updateEmergencyContact(userId, contactId(req), req.body)
  res.json({ success: true, emergencyContact: toEmergencyContact(contact) })
}

export const deleteEmergencyContactController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  await deleteEmergencyContact(userId, contactId(req))
  res.json({ success: true, message: 'Emergency contact removed.' })
}

export const setPrimaryEmergencyContactController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const contact = await setPrimaryEmergencyContact(userId, contactId(req))
  res.json({ success: true, emergencyContact: toEmergencyContact(contact) })
}
