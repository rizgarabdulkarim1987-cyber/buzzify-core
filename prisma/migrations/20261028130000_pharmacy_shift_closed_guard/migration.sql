-- Nothing is posted into a shift that is not OPEN. A sale (or a cash movement, or a return) that read its shift as open and
-- then lost a race with the close would otherwise land after the close, uncounted. The trigger reads the shift row with
-- FOR KEY SHARE: while a close holds the row (FOR UPDATE) the insert waits for it, then sees CLOSED and is refused with
-- the message PH_SHIFT_CLOSED; and a close started after the insert waits for the insert's transaction (the foreign key
-- already holds the same lock), so the close counts it. FOR KEY SHARE (not FOR SHARE) because a transaction that already
-- holds that lock from its first insert is never made to wait on a close that is itself waiting for it. Additive: a
-- function and three triggers; no existing row is read or changed.
CREATE FUNCTION "ph_shift_must_be_open"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  shift_status "PhShiftStatus";
BEGIN
  SELECT "status" INTO shift_status FROM "PhShift" WHERE "id" = NEW."shiftId" FOR KEY SHARE;
  -- A shift that does not exist is the foreign key's to report.
  IF shift_status IS NOT NULL AND shift_status <> 'OPEN' THEN
    RAISE EXCEPTION 'PH_SHIFT_CLOSED: the shift is closed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PhSale_shift_open" BEFORE INSERT ON "PhSale" FOR EACH ROW EXECUTE FUNCTION "ph_shift_must_be_open"();
CREATE TRIGGER "PhCashMovement_shift_open" BEFORE INSERT ON "PhCashMovement" FOR EACH ROW EXECUTE FUNCTION "ph_shift_must_be_open"();
CREATE TRIGGER "PhReturn_shift_open" BEFORE INSERT ON "PhReturn" FOR EACH ROW EXECUTE FUNCTION "ph_shift_must_be_open"();
