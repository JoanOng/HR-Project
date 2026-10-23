This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Users & Roles

> [!WARNING]
> **Dev only.** The seed creates all dev users with the same password, `Password123!`. Never use it in production.

| Email                 | Role       | Employee                | What it's for                                                                                                   |
| --------------------- | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `hr@example.com`      | `HR`       | n/a                     | Creates and prepares payroll runs                                                                               |
| `hr2@example.com`     | `HR`       | n/a                     | Second HR: completes and publishes runs (a run can't be completed by the HR who prepared it)                    |
| `manager@example.com` | `MANAGER`  | EMP-0001 (Morgan Lead)  | Approves timesheets and leave for their direct reports                                                          |
| `alice@example.com`   | `EMPLOYEE` | EMP-0002 (Alice Tan)    | Submits timesheets, requests leave, views own published payslips                                                |
| `bob@example.com`     | `EMPLOYEE` | EMP-0003 (Bob Ng)       | Same as Alice                                                                                                   |


## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
