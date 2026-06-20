/**
 * @file app/(dashboard)/dashboard/products/new/layout.tsx
 * @description Shared layout wrapping all 7 intake steps.
 *   Centers content at max-width 780px.
 *   The IntakeSteps bar is rendered per-page so each step controls its own
 *   currentStep value.
 */

export default function IntakeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {children}
    </div>
  );
}
