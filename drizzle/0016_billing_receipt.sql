-- The screenshot of an InstaPay transfer, so the person approving a payment can
-- see the proof rather than taking a reference number on trust.
--
-- The app offers this upload on G4; without somewhere to put it the file was
-- being accepted and discarded, which is worse than not asking for it.

ALTER TABLE "billing_payment" ADD COLUMN IF NOT EXISTS receipt_url text;
