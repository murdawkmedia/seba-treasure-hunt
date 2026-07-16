PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS trg_legal_document_review_events_immutable
BEFORE UPDATE ON legal_document_review_events
BEGIN
  SELECT RAISE(ABORT, 'legal document review events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_legal_document_review_events_immutable_delete
BEFORE DELETE ON legal_document_review_events
BEGIN
  SELECT RAISE(ABORT, 'legal document review events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_waiver_acceptance_participants_immutable
BEFORE UPDATE ON waiver_acceptance_participants
BEGIN
  SELECT RAISE(ABORT, 'waiver acceptance participants are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_waiver_acceptance_participants_immutable_delete
BEFORE DELETE ON waiver_acceptance_participants
BEGIN
  SELECT RAISE(ABORT, 'waiver acceptance participants are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_notification_delivery_events_immutable
BEFORE UPDATE ON notification_delivery_events
BEGIN
  SELECT RAISE(ABORT, 'notification delivery events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_notification_delivery_events_immutable_delete
BEFORE DELETE ON notification_delivery_events
BEGIN
  SELECT RAISE(ABORT, 'notification delivery events are immutable');
END;
