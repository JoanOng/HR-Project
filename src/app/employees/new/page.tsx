import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { EmployeeForm } from "./employee-form";

export const metadata = { title: "New employee — HR" };

export default async function NewEmployeePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "HR") redirect("/employees"); // HR-only screen

  return (
    <main className="flex-1 px-8 py-6">
      <h1 className="mb-4 text-2xl font-semibold">New employee</h1>
      <EmployeeForm />
    </main>
  );
}