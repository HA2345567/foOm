/**
 * Simple local subscription and usage tracking.
 * Securely calls Vercel Serverless Functions for Polar.sh integration.
 */

export interface UserStatus {
  isPro: boolean;
  recordingCount: number;
  email?: string;
  lastVerified?: number;
}

export interface PolarPlan {
  id: string;
  name: string;
  description: string;
  price: string;
  checkoutUrl: string;
  features: string[];
  isHighlighted: boolean;
}

// Client-side call to our secure Vercel API
export async function getPricingPlans() {
  try {
    const res = await fetch("/api/pricing");
    return await res.json();
  } catch (err) {
    return { success: false, error: "Network error" };
  }
}

const STORAGE_KEY = "foom_user_status";

// Client-side call to our secure Vercel API
export async function checkSubscriptionByEmail(email: string) {
  try {
    const res = await fetch("/api/check-sub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: "Network error" };
  }
}

// Client-side call to our secure Vercel API
export async function verifyPolarCheckout(checkoutId: string) {
  try {
    const res = await fetch(`/api/verify-checkout?checkoutId=${checkoutId}`);
    return await res.json();
  } catch (err) {
    return { success: false, error: "Network error during verification" };
  }
}

export function getUserStatus(): UserStatus {
  if (typeof window === "undefined") return { isPro: false, recordingCount: 0 };
  
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      // Ignore
    }
  }
  
  return { isPro: false, recordingCount: 0 };
}

export function incrementRecordingCount() {
  const status = getUserStatus();
  status.recordingCount += 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  return status;
}

export function setProStatus(isPro: boolean, email?: string) {
  const status = getUserStatus();
  status.isPro = isPro;
  if (email) status.email = email;
  status.lastVerified = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  return status;
}

export function checkCanRecord(): { canRecord: boolean; reason?: "limit_reached" } {
  const status = getUserStatus();
  
  if (status.isPro) return { canRecord: true };
  
  // Free limit: 3 recordings
  if (status.recordingCount >= 3) {
    return { canRecord: false, reason: "limit_reached" };
  }
  
  return { canRecord: true };
}
