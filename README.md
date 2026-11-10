# Internal Sys — Fleet Operations & Driver Earnings CRM

Modern trucking operations CRM for managing Amazon Relay loads, driver earnings, gross boards, and weekly paycheck settlements.

## Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS v4
- React Router
- Recharts
- Lucide icons
- date-fns / sonner

## Features

- **Overview** — KPI cards, revenue charts, load status distribution, alerts, activity feed
- **Loads CRM** — full CRUD, filters, sorting, detail drawer, status history
- **Gross Board** — fleet-wide daily/weekly/monthly driver gross with TOTAL FLEET row
- **Gross by Driver** — driver-level financial analysis tied to loads
- **Payments / Paycheck** — weekly settlements, fee snapshots, partial payments, adjustments
- **Drivers** — profiles, fee configuration, load & payment history
- **Settlements & Charges** — one-time charges with settlement-period scoping
- **Reports** — fleet revenue, driver comparison, deductions, outstanding balances
- **Settings** — company profile and system snapshot

## Getting started

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Data

Sample data includes 16 drivers, 110+ loads across 4 weeks, varied fee profiles, one-time charges, and multi-status settlements. All financial totals are derived from underlying records via `src/lib/calculations.ts`.

Supabase-ready schema: `supabase/schema.sql`.

## Design

Blue-and-white enterprise SaaS palette (`#174A8B` primary, `#F5F8FC` background).
