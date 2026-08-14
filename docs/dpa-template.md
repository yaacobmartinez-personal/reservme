# Data Processing Agreement (template)

> **This is a template, not executed legal advice.** It is drafted to match how
> ReservMe actually processes data, but a lawyer should review it before you
> rely on it. Fill the bracketed fields and have both parties sign.

This Data Processing Agreement ("DPA") forms part of the agreement between:

- **[Venue legal name]** ("the Controller" / Personal Information Controller), and
- **ReservMe [legal entity]** ("the Processor" / Personal Information Processor),

and governs the Processor's handling of personal data on the Controller's
behalf under the Philippine Data Privacy Act of 2012 (RA 10173) and its IRR.

## 1. Roles

The Controller (the venue) decides why and how its customers' personal data is
processed. The Processor (ReservMe) processes that data only to provide the
booking service, on the Controller's documented instructions.

## 2. Subject matter and duration

The Processor processes personal data for as long as the Controller uses
ReservMe, and returns or deletes it on termination per section 9.

## 3. Nature and purpose

Taking and managing reservations: capturing bookings, showing availability,
sending booking confirmations and reminders, and providing the Controller a
schedule and customer list.

## 4. Categories of data subjects

The Controller's customers who make bookings, and the Controller's own staff
who use the dashboard.

## 5. Categories of personal data

Name, email address, optional mobile number, and booking details (space, time,
amount). No payment card data is processed by the Processor in the pay-at-venue
model. No sensitive personal information is intentionally collected.

## 6. Processor obligations

The Processor shall:

1. process personal data only on the Controller's documented instructions;
2. ensure persons authorised to process the data are bound by confidentiality;
3. implement appropriate technical and organisational security measures
   (section 7);
4. not engage another sub-processor without the Controller's general
   authorisation, and remain responsible for its sub-processors (section 8);
5. assist the Controller in responding to data-subject requests (access,
   correction, erasure, objection, portability);
6. assist the Controller with security, breach notification, and any privacy
   impact assessment obligations;
7. make available information necessary to demonstrate compliance and allow for
   reasonable audits.

## 7. Security measures

Encryption in transit; hashed credentials; least-privilege access; tenant
isolation enforced at the data layer; a booking engine that prevents
double-booking at the database level; rate limiting against abuse; and regular
database backups.

## 8. Sub-processors

The Controller authorises the following sub-processors:

| Sub-processor | Purpose | Location |
| --- | --- | --- |
| [Hosting / database provider] | Application hosting and database | [region] |
| Resend | Transactional email (confirmations, reminders) | [region] |
| [Payment provider — when online payments are enabled] | Payment processing | [region] |

The Processor will give the Controller notice before adding or replacing a
sub-processor, and the Controller may object on reasonable data-protection
grounds.

## 9. Return and deletion

On termination, or on the Controller's request, the Processor will make the
Controller's data available for export and will delete it within [30] days,
except where retention is required by law.

## 10. Breach notification

The Processor will notify the Controller without undue delay after becoming
aware of a personal-data breach affecting the Controller's data, with the
information the Controller needs to meet its own notification duties to the
National Privacy Commission and affected individuals.

## 11. Liability and governing law

This DPA is governed by the laws of the Republic of the Philippines. Liability
is as set out in the main agreement between the parties.

---

**Controller:** ______________________  **Date:** ____________

**Processor (ReservMe):** ______________________  **Date:** ____________
