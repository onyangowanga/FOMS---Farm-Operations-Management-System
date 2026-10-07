# FOMS Architecture Guide

## Purpose

This document defines the architectural standards, coding conventions, project structure, and development guidelines for the Farm Operations Management System (FOMS).

This serves as the single source of truth for all future AI-assisted development using Claude Sonnet, GitHub Copilot, or any other coding assistant.

---

# Architecture Principles

## 1. Simplicity First

- Prefer simple, maintainable solutions.
- Avoid unnecessary abstractions.
- Avoid premature optimization.
- Build only what is required.

## 2. Feature-Based Architecture

Organize code by business feature rather than technical layer.

Example:

```text
src/
├── modules/
│   ├── auth/
│   ├── crops/
│   ├── livestock/
│   ├── inventory/
│   ├── finance/
│   ├── tasks/
│   ├── reports/
│   └── farm-journal/
```

Each module owns its:

- Routes
- Controllers
- Services
- Validation
- Database access

---

# High-Level Architecture

```text
Frontend (PWA)
       |
       v
REST API (Express)
       |
       v
Business Services
       |
       v
Prisma ORM
       |
       v
PostgreSQL
```

Additional Services:

```text
PDFKit
ExcelJS
File Storage
Notification Service
Audit Logs
```

---

# Technology Standards

## Frontend

- Vanilla JavaScript ES Modules
- Tailwind CSS 3
- HTML5
- Service Workers
- IndexedDB for offline support

Rules:

- No React
- No Vue
- No Angular
- No jQuery

---

## Backend

- Node.js LTS
- Express 5
- JWT Authentication
- bcryptjs
- Prisma ORM

---

## Database

- PostgreSQL
- UUID primary keys
- Soft deletes where necessary
- CreatedAt and UpdatedAt timestamps on all entities

---

# Multi-Tenant SaaS Strategy

The platform should support multiple independent farms.

Core hierarchy:

```text
Organization
    |
    +-- Farms
            |
            +-- Blocks
                    |
                    +-- Operations
```

Every business entity must belong to:

```text
organizationId
```

This enables future SaaS expansion.

---

# Folder Structure

```text
foms/
│
├── client/
│   ├── assets/
│   ├── components/
│   ├── layouts/
│   ├── pages/
│   ├── services/
│   ├── store/
│   ├── utils/
│   └── sw.js
│
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── modules/
│   │   ├── shared/
│   │   ├── services/
│   │   ├── utils/
│   │   └── app.js
│   │
│   └── prisma/
│       ├── schema.prisma
│       └── migrations/
│
├── docs/
├── uploads/
└── docker/
```

---

# Backend Module Structure

Example:

```text
modules/crops/
│
├── crop.routes.js
├── crop.controller.js
├── crop.service.js
├── crop.repository.js
├── crop.validator.js
└── crop.constants.js
```

Responsibilities:

Routes → HTTP endpoints

Controllers → request handling

Services → business logic

Repositories → database access

Validators → payload validation

---

# Authentication Architecture

Authentication:

- JWT Access Tokens
- Refresh Tokens
- Password Hashing via bcryptjs

Role-Based Access Control:

```text
OWNER
MANAGER
AGRONOMIST
WORKER
```

Middleware:

```text
authenticate()
authorize()
```

Example:

```javascript
router.post(
  '/expenses',
  authenticate(),
  authorize('OWNER','MANAGER'),
  createExpense
);
```

---

# API Standards

Base URL:

```text
/api/v1
```

Naming Convention:

```text
GET    /api/v1/crops
GET    /api/v1/crops/:id
POST   /api/v1/crops
PUT    /api/v1/crops/:id
DELETE /api/v1/crops/:id
```

Response Format:

```json
{
  "success": true,
  "message": "Crop created",
  "data": {}
}
```

---

# Database Standards

## Primary Keys

Always use:

```text
UUID
```

## Naming

Tables:

```text
snake_case
```

Columns:

```text
camelCase
```

## Audit Fields

Every table should contain:

```text
id
createdAt
updatedAt
createdBy
updatedBy
```

---

# File Management

Supported uploads:

- Images
- PDFs
- Excel files
- Reports
- Receipts

Directory structure:

```text
uploads/
├── crops/
├── livestock/
├── receipts/
├── reports/
└── documents/
```

Store metadata in PostgreSQL.

---

# Reporting Architecture

Use:

- PDFKit for PDF generation
- ExcelJS for spreadsheets

Report Categories:

- Daily Reports
- Weekly Reports
- Monthly Reports
- Financial Reports
- Crop Reports
- Livestock Reports

---

# PWA Architecture

Requirements:

- Installable
- Offline capable
- Mobile first
- Fast loading

Offline strategy:

```text
IndexedDB
      |
Queue Changes
      |
Sync When Online
```

Cache:

- Dashboard
- Tasks
- Crop Records
- Livestock Records

---

# UI Design Standards

Design Goals:

- Simple
- Professional
- Fast
- Mobile-friendly

Primary Screens:

- Login
- Dashboard
- Crops
- Livestock
- Inventory
- Finance
- Reports
- Settings

Tailwind Guidelines:

- Consistent spacing scale
- Reusable card layouts
- Reusable form components
- Responsive tables

---

# Error Handling Standards

Centralized error handler.

Example:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": []
}
```

Never expose stack traces to users.

---

# Logging & Audit Trail

Track:

- Logins
- Record creation
- Record updates
- Record deletions
- Approvals

Audit fields:

```text
userId
action
entity
entityId
timestamp
```

---

# Development Workflow

Phase 1

- Authentication
- Organizations
- Farms
- Dashboard
- Crops
- Livestock

Phase 2

- Tasks
- Operations
- Farm Journal
- Inventory

Phase 3

- Finance
- Reporting
- Notifications

Phase 4

- Analytics
- Forecasting
- Multi-farm SaaS enhancements

---

# Coding Standards

JavaScript:

- ES Modules only
- Async/Await only
- No callback nesting
- Prefer pure functions

General:

- Keep functions small
- Single responsibility principle
- Reusable utilities
- Consistent naming conventions

---

# Future Enhancements

Prepare architecture for:

- WhatsApp notifications
- SMS alerts
- Weather integrations
- GIS farm mapping
- QR-coded livestock tracking
- AI recommendations
- Mobile photo recognition
- Financial forecasting

---

# AI Development Rules

When generating code:

1. Follow this architecture strictly.
2. Maintain feature-based organization.
3. Avoid unnecessary dependencies.
4. Use PostgreSQL and Prisma only.
5. Produce production-ready code.
6. Prioritize maintainability over cleverness.
7. Ensure all new features work within the multi-tenant SaaS model.
