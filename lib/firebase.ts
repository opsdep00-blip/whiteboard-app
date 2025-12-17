// Placeholder for Firebase initialization. Replace with actual config pulled from
// environment variables or Secret Manager before enabling persistence.

export type FirestorePlan = {
  readsPerMonth: number;
  writesPerMonth: number;
  storageGb: number;
};

export const freeTierPlan: FirestorePlan = {
  readsPerMonth: 50_000,
  writesPerMonth: 20_000,
  storageGb: 1
};

export const estimateCostSavings = (plannedReads: number): string => {
  if (plannedReads <= freeTierPlan.readsPerMonth) {
    return "0 USD (within free tier)";
  }

  const overage = plannedReads - freeTierPlan.readsPerMonth;
  const est = (overage / 100_000) * 0.06; // Firestore on-demand read pricing snapshot
  return `$${est.toFixed(2)} approx.`;
};
