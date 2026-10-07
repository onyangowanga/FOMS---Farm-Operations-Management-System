# FOMS Project Specification

## Project Overview

You are a senior full-stack software engineer helping build a production-ready web application called **FOMS (Farm Operations Management System).**

FOMS is a multi-user farm management platform designed for mixed farming enterprises that manage both crop and livestock operations.

The primary goal is to digitize farm operations, improve visibility into daily activities, track production, manage costs, and generate management reports.

The system must be simple enough for farm workers to use while providing detailed reporting for farm managers and owners.

---

# Technical Stack

## Frontend

- Vanilla JavaScript (ES Modules)
- Tailwind CSS 3
- Responsive Mobile-First Design
- PWA Support
- No React
- No Vue
- No Angular

## Backend

- Node.js
- Express 5
- JWT Authentication
- bcryptjs Password Hashing

## Database

- PostgreSQL
- Prisma ORM

## Reporting

- PDFKit
- ExcelJS

## Deployment

- Docker-ready
- Environment variables for configuration
- Production-ready folder structure

---

# User Roles

## 1. Farm Owner

Permissions:

- View all reports
- View finances
- Approve expenses
- View profitability
- Manage staff

## 2. Farm Manager

Permissions:

- Crop management
- Livestock management
- Inventory management
- Task assignments
- Expense management
- Report generation

## 3. Agronomist

Permissions:

- View crop data
- Record field observations
- Add recommendations
- Upload soil reports
- Upload pathology reports

## 4. Farm Workers

Permissions:

- View assigned tasks
- Submit daily activity reports
- Upload photos
- Update task progress

---

# Core Business Modules

## Module 1: Dashboard

Create a modern dashboard displaying:

### Crop Summary
- Total acreage
- Active crops
- Planting schedules
- Harvest forecasts

### Livestock Summary
- Goats count
- Sheep count
- Poultry count
- Mortality figures

### Financial Summary
- Income
- Expenses
- Net Profit

### Operations Summary
- Open tasks
- Completed tasks
- Overdue tasks

## Module 2: Farm Structure

The system must support:

### Farms
A client may own multiple farms.

### Farm Blocks
Each farm contains multiple blocks or plots.

Example:

```text
Farm A

Block A
Block B
Block C
```

Each block stores:

- Name
- Size
- GPS coordinates
- Current use
- Soil information

## Module 3: Crop Management

Track the full crop lifecycle.

### Crop Master Data

Store:

- Crop Name
- Variety
- Growth Period
- Expected Yield

### Crop Cycle

Track:

- Nursery Date
- Planting Date
- Fertilizer Applications
- Chemical Applications
- Irrigation Records
- Weeding Activities
- Harvest Records

## Module 4: Livestock Management

Support:

- Goats
- Sheep
- Poultry

For each animal or batch track:

- Identification Number
- Breed
- Age
- Weight
- Health Status
- Vaccination History

For poultry:

- Batch Number
- Quantity
- Feed Consumption
- Egg Production
- Mortality

## Module 5: Daily Farm Operations

This is the heart of the system.

Every activity performed on the farm should be logged.

Fields:

- Date
- Activity
- Category
- Responsible Person
- Location
- Cost
- Notes
- Photos

Examples:

- Planting
- Irrigation
- Vaccination
- Harvesting
- Feeding
- Maintenance

## Module 6: Task Management

Create task workflow.

Fields:

- Title
- Description
- Assigned To
- Due Date
- Priority
- Status

Statuses:

- Pending
- In Progress
- Completed
- Approved

Workflow:

```text
Manager Creates Task
      ↓
Worker Executes Task
      ↓
Worker Submits Evidence
      ↓
Manager Approves
```

## Module 7: Input Inventory

Track:

### Crop Inputs
- Seeds
- Fertilizers
- Chemicals

### Livestock Inputs
- Feed
- Vaccines
- Supplements

### Farm Assets
- Pumps
- Tools
- Irrigation Equipment

Track:

- Stock In
- Stock Out
- Current Quantity
- Reorder Level

## Module 8: Expense Management

Track all farm expenses.

Categories:

- Labor
- Seed
- Fertilizer
- Chemicals
- Feed
- Transport
- Veterinary
- Fuel
- Repairs

Fields:

- Date
- Supplier
- Amount
- Payment Method
- Attachment
- Notes

## Module 9: Income Management

Track:

- Crop Sales
- Livestock Sales
- Egg Sales
- Other Revenue

Fields:

- Product
- Quantity
- Unit Price
- Total Sale
- Buyer
- Sale Date

## Module 10: Reporting

Generate:

### Daily Report
- Activities performed
- Tasks completed
- Issues reported

### Weekly Report
- Crop progress
- Livestock status
- Operational challenges

### Monthly Report
- Financial summary
- Production summary
- Performance metrics

Export formats:

- PDF
- Excel

## Module 11: Documents Repository

Store:

- Soil Test Reports
- Water Analysis Reports
- Pathology Reports
- Farm Licenses
- Purchase Receipts
- Agronomist Reports

Support file uploads and document categorization.

---

# Notifications

Provide notification support for:

- Upcoming harvest dates
- Vaccination schedules
- Low inventory alerts
- Overdue tasks
- Outstanding approvals

Design system architecture such that WhatsApp, SMS, and Email notifications can be added later.

---

# PWA Requirements

The application must function as a Progressive Web App.

Features:

- Installable on Android
- Offline support
- Cached assets
- Sync pending records when internet returns
- Mobile-first design

---

# Dashboard Analytics

### Crop Analytics
- Yield per acre
- Crop profitability
- Input cost per acre

### Livestock Analytics
- Feed consumption trends
- Mortality rate
- Production trends

### Farm Financial Analytics
- Monthly expenses
- Monthly revenue
- Net profit trends

---

# Non-Functional Requirements

- Clean modular architecture
- Secure authentication
- Role-based authorization
- Responsive design
- REST API architecture
- Scalable database schema
- Audit trails for critical actions
- File upload support
- Production-ready code

---

# Farm Journal (Strategic Module)

The Farm Journal should be a first-class feature.

Capture:

- Daily observations
- Activities performed
- Costs incurred
- Photos
- Recommendations
- Weather observations
- Pest and disease incidents

This historical dataset will later support analytics, profitability tracking, and AI-assisted recommendations.

---

# AI Development Task

Using this specification:

1. Design the complete PostgreSQL database schema.
2. Create Prisma models.
3. Design backend architecture.
4. Design REST API endpoints.
5. Design frontend architecture using Vanilla JavaScript modules.
6. Implement the system incrementally following a feature-based architecture.
7. Produce maintainable, scalable, and production-ready code suitable for deployment as a SaaS platform serving multiple farms.
