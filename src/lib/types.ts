export type PlanRow = {
  id: string; code: string; nameAr: string; nameEn: string; description: string | null; isActive: boolean; trialDays: number;
  priceMonthly: string; priceYearly: string; currency: string; maxUsers: number; maxBranches: number; storageMb: number;
  features: string[]; sortOrder: number; activeSubscriptions: number;
};
