# FOMS Roadmap

## Project Overview

**FOMS (Farm Operations Management System)** is a multi-tenant farm management platform designed to support crop farming, livestock management, farm operations, inventory tracking, financial management, reporting, and future SaaS deployment.

This roadmap defines the phased development approach, deliverables, milestones, and release objectives.

---

# Vision

Build a lightweight, offline-capable, mobile-first farm management platform that enables:

- Farm operational control
- Farm performance monitoring
- Financial visibility
- Staff accountability
- Production tracking
- Decision support through reporting and analytics

The long-term goal is to evolve FOMS into a SaaS product for commercial farms across East Africa.

---

# Development Philosophy

- Build small
- Release early
- Iterate continuously
- Focus on real farm workflows
- Prioritize usability over complexity
- Mobile-first
- Offline-first where practical

---

# Release Strategy

## Version 0.1 - Foundation

- Backend setup
- Frontend setup
- PostgreSQL + Prisma
- JWT authentication
- Role management
- Base UI layout
- PWA foundation

## Version 0.2 - Farm Structure

- Organizations
- Farms
- Blocks / Plots
- GPS coordinates
- Farm hierarchy

Implemented in the Version 0.2 update: organization hierarchy and owner-only workspace renaming, farm/block editing and filtering, GPS entry and device location capture, farm-specific crop/journal block selection, and linked-record archive guards. Existing records are preserved through an additive farm-coordinate migration.

## Version 0.3 - Crop Management

- Crop master data
- Crop lifecycle tracking
- Irrigation records
- Fertilizer applications
- Harvest management

Implemented in Version 0.3: client-scoped crop master data, nursery/transplant planning and expected harvest dates, crop detail pages, explicit observed stage changes with preserved history, irrigation and fertilizer logs, and harvest records with unit-specific totals. Includes username login, admin-only client onboarding, workspace user management, password changes and compact linked mobile dashboard cards. Stages do not advance automatically; harvest logs do not create sales or stock movements.

Version 0.3.1 polishing (before Version 0.4): per-cycle yielding-day harvest suggestions, custom activities and specified units, admin client editing and single-use 24-hour password resets with mandatory password change, timestamped crop/livestock/general daily reports with optional private photos, stacked mobile records, and worker-only dashboard/assigned-task/own-report/account access. Full Version 0.4 livestock features remain a separate release.

## Version 0.4 - Livestock Management

- Goats
- Sheep
- Poultry
- Vaccinations
- Health records
- Mortality tracking

Implemented in Version 0.4: individual or batch tracking for goats, sheep and poultry; mobile list/detail profiles; birth/hatch dates and age; append-only vaccination, health, weight and mortality history; automatic serialized living-count deductions; poultry feed-consumption and egg-production logs and totals. Preserves worker daily-report restrictions and existing records. No breeding, movements or automatic stock/sales integration.

## Version 0.5 - Task Management

- Task creation
- Assignment workflow
- Evidence uploads
- Approvals
- Notifications foundation

Implemented in Version 0.5: linked mobile task lists/details, editable assignment/priority/due dates, private photo/PDF evidence with per-task requirement, explicit start/submit/approve and explained rework workflow, preserved history and recipient-scoped in-app notifications with unread/read controls. Workers retain assigned-task-only access. No external notification delivery or recurring-task scheduler.

## Version 0.6 - Farm Journal

- Daily operational logs
- Field observations
- Pest and disease incidents
- Weather observations
- Photo documentation

Implemented in Version 0.6: filtered mobile journal cards/details/editing; operational, field, weather and recommendation reports; simple worker crop/livestock/general reporting with private optional photos; staff-assessed incident severity; append-only dated Open/Resolved follow-ups with safe retries and backdated-state protection. Existing reports/photos and worker own-report restrictions are retained. No external weather integration or automatic journal-to-finance transactions.

## Version 0.7 - Inventory

- Seeds
- Fertilizers
- Chemicals
- Feed
- Vaccines
- Asset tracking
- Reorder alerts

Implemented in Version 0.7: mobile filtered stock cards and linked details; receive/issue history and explained physical-count corrections; exact 3-decimal quantities with atomic no-overdraw and replay-safe browser saves; editable profiles and zero-stock archival; hybrid quantity-based tools versus individual equipment with identification, condition, dated append-only maintenance and permanent retirement. Low-stock batches appear in the list/dashboard and notify owners/managers in their existing Inbox once per low-stock episode. Agronomists retain read-only access; workers have no inventory access. Existing stock/history is preserved; no procurement, external alerts or automatic finance/livestock posting.

## Version 0.8 - Finance

- Expenses
- Revenue tracking
- Profit calculation
- Financial summaries

Implemented in Version 0.8: mobile expense/invoice details, pending expense editing and private receipts, owner-only approval with approved record locks, precise monetary values and replay-safe invoice/payment saves, no concurrent overpayment, unpaid invoice editing/archiving and paid invoice locks. Finance summarizes farm/date/currency-scoped revenue, approved/pending expenses, approved-basis profit, collections, current invoice balances and category breakdowns without mixing currencies. Dashboard KES profit follows the same approved-only policy. Financial operations require a connection; no refunds/tax/payroll/bank processing or automatic inventory posting. PDF/Excel exports remain V0.9.

## Version 0.9 - Reporting

- Daily reports
- Weekly reports
- Monthly reports
- PDF exports
- Excel exports

Implemented in Version 0.9: separate operations/financial report pages with daily, Monday-Sunday weekly and calendar-month filters in Africa/Nairobi; farm scopes; owner/manager previews and genuine PDF/XLSX exports; crop-only agronomist reports. Operations combine period records and explicitly labelled current status snapshots; financial reports preserve V0.8 approved-only profit, pending expenses and separate currencies. Mobile paged record cards, private online-only downloads, explicit size limits without truncation, numeric Excel cells and literal-safe user text. No historical closing-state reconstruction, scheduled email delivery or advanced analytics.

## Version 1.0 - Production Release

- User Acceptance Testing
- Security review
- Performance optimization
- Backup strategy
- Production deployment

---

# Future Releases

## Version 1.1

- Email notifications
- SMS integration readiness
- WhatsApp integration readiness

## Version 1.2

- Crop analytics
- Livestock analytics
- Financial analytics

## Version 1.3

- Irrigation management
- Equipment maintenance
- Water consumption tracking

## Version 1.4

- GIS mapping
- GPS plot visualization
- Satellite integration readiness

## Version 2.0

- Full SaaS platform
- Tenant management
- Subscription management
- White-label support

---

# Development Milestones

## Milestone 1

Foundation

- Authentication
- Database
- PWA setup
- Farm structure

## Milestone 2

Operations

- Crops
- Livestock
- Tasks
- Journal

## Milestone 3

Management

- Inventory
- Finance
- Reporting

## Milestone 4

Optimization

- Notifications
- Analytics
- Advanced operations

## Milestone 5

Commercialization

- SaaS architecture
- Tenant onboarding
- Subscription management

---

# Initial MVP Scope

1. Authentication
2. Organizations
3. Farms & Blocks
4. Crop Management
5. Livestock Management
6. Tasks
7. Farm Journal
8. Expense Tracking
9. Dashboard

This MVP is sufficient for the first client deployment and provides a strong foundation for future SaaS expansion.
