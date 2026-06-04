// audit.js
// Central append-only audit ledger for Vectair Flite.
// Scope: VKB reference-data changes only (movements, bookings etc. are out of scope for this ticket).

export const AUDIT_LOG_KEY = "vectair_flite_audit_log_v1";

const SCHEMA_VERSION = 1;

function nowISO() {
  return new Date().toISOString();
}

function generateId() {
  const ts = nowISO().replace(/\D/g, '').slice(0, 17);
  const rand = Math.random().toString(36).slice(2, 8);
  return `audit_${ts}_${rand}`;
}

function generateCorrelationId() {
  const ts = nowISO().replace(/\D/g, '').slice(0, 17);
  const rand = Math.random().toString(36).slice(2, 6);
  return `op_${ts}_${rand}`;
}

/**
 * Read the audit log from localStorage.
 * Returns a safe default if absent or malformed.
 */
export function getAuditLog() {
  try {
    const raw = localStorage.getItem(AUDIT_LOG_KEY);
    if (!raw) return { version: 1, updatedAt: null, events: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.events)) {
      return { version: 1, updatedAt: null, events: [] };
    }
    return parsed;
  } catch (_) {
    return { version: 1, updatedAt: null, events: [] };
  }
}

/**
 * Write the audit log to localStorage, stamping updatedAt.
 */
export function saveAuditLog(log) {
  localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify({ ...log, updatedAt: nowISO() }));
}

/**
 * Append one event to the audit log.
 * Generates id, changedAt, schemaVersion, actor, correlationId if not supplied.
 */
export function appendAuditEvent(event) {
  const log = getAuditLog();
  const now = nowISO();
  const completed = {
    ...event,
    schemaVersion: SCHEMA_VERSION,
    id: event.id || generateId(),
    changedAt: event.changedAt || now,
    correlationId: event.correlationId || generateCorrelationId(),
    actor: event.actor || { type: 'local-user', displayName: 'local user' },
    app: event.app || { name: 'Vectair Flite', version: 'dev', build: 'unknown' },
  };
  log.events.push(completed);
  saveAuditLog(log);
  return completed;
}

/**
 * Compare before/after field values and return only changed fields.
 * Normalises using string conversion for comparison but preserves actual
 * stored values in the returned before/after objects.
 *
 * @param {Object} before
 * @param {Object} after
 * @param {string[]|null} fields - limit comparison to these fields; null = all fields from both objects
 * @returns {{ before: Object, after: Object, changedFields: string[] }}
 */
export function buildFieldDiff(before, after, fields = null) {
  const b = before || {};
  const a = after || {};
  const allFields = fields || [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const changedFields = [];
  const beforeDiff = {};
  const afterDiff = {};

  for (const field of allFields) {
    const bVal = b[field] !== undefined ? b[field] : null;
    const aVal = a[field] !== undefined ? a[field] : null;
    const bStr = bVal === null ? '' : String(bVal);
    const aStr = aVal === null ? '' : String(aVal);
    if (bStr !== aStr) {
      changedFields.push(field);
      beforeDiff[field] = bVal;
      afterDiff[field] = aVal;
    }
  }

  return { before: beforeDiff, after: afterDiff, changedFields };
}

/**
 * Convenience wrapper: compute field diff and append an audit event.
 * Returns null if no fields changed.
 */
export function auditEntityChange({
  domain,
  dataset,
  entityType = 'reference-record',
  entityId,
  label,
  action,
  before = {},
  after = {},
  source,
  reason,
  effectiveFrom = new Date().toISOString().slice(0, 10),
  effectiveTo = null,
  correlationId,
  reversible = true
}) {
  const diff = buildFieldDiff(before, after);
  if (diff.changedFields.length === 0) return null;

  return appendAuditEvent({
    effectiveFrom,
    effectiveTo,
    source: source || { module: 'admin-vkb-editor', uiAction: 'save-local-override' },
    entity: {
      domain,
      dataset,
      type: entityType,
      id: entityId,
      label: label || entityId
    },
    action,
    before: diff.before,
    after: diff.after,
    changedFields: diff.changedFields,
    reason: reason || { code: 'operational-reference-update', note: '' },
    ...(correlationId ? { correlationId } : {}),
    reversible
  });
}

/**
 * Return all audit events for a specific entity (domain + id).
 */
export function getAuditEventsForEntity(domain, entityId) {
  const log = getAuditLog();
  return log.events.filter(e =>
    e.entity && e.entity.domain === domain && e.entity.id === entityId
  );
}

/**
 * Return top-level summary stats.
 */
export function getAuditSummary() {
  const log = getAuditLog();
  return {
    totalEvents: log.events.length,
    updatedAt: log.updatedAt
  };
}
