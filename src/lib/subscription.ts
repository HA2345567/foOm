import { createServerFn } from "@tanstack/react-start";

/**
 * Simple local subscription and usage tracking.
 * In a real production app, this would be backed by a database and 
 * verified against the Polar.sh API.
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

// Server function to fetch products from Polar
export const getPricingPlans = createServerFn({ method: "GET" })
  .handler(async () => {
    const token = process.env.POLAR_ACCESS_TOKEN;
    if (!token) return { success: false, error: "No token" };

    try {
      // 1. Get organization info
      const orgsRes = await fetch("https://api.polar.sh/v1/organizations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!orgsRes.ok) return { success: false, error: "Failed to fetch orgs" };
      const orgs = await orgsRes.json();
      if (!orgs.items || orgs.items.length === 0) return { success: false, error: "No orgs" };

      const orgId = orgs.items[0].id;

      // 2. Get products for this org
      const productsRes = await fetch(`https://api.polar.sh/v1/products?organization_id=${orgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!productsRes.ok) return { success: false, error: "Failed to fetch products" };
      const products = await productsRes.json();

      // 3. Map to our UI format
      const plans: PolarPlan[] = products.items.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description || "",
        price: `$${p.prices?.[0]?.price_amount / 100 || 0}`,
        checkoutUrl: `https://polar.sh/checkout/${p.id}`, // Placeholder if we don't have a direct checkout link API
        features: p.benefits?.map((b: any) => b.description) || [],
        isHighlighted: p.name.toLowerCase().includes("pro"),
      }));

      return { success: true, plans };
    } catch (err) {
      return { success: false, error: "Network error" };
    }
  });

const STORAGE_KEY = "foom_user_status";

// Server function to verify subscription by email
export const checkSubscriptionByEmail = createServerFn({ method: "POST" })
  .handler(async (ctx: any) => {
    const email = ctx.data as string;
    const token = process.env.POLAR_ACCESS_TOKEN;
    if (!token) return { success: false, error: "Server configuration error" };

    try {
      // 1. Find customer by email
      const customerRes = await fetch(`https://api.polar.sh/v1/customers?email=${encodeURIComponent(email)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!customerRes.ok) return { success: false, error: "Customer not found" };
      const customers = await customerRes.json();
      
      if (!customers.items || customers.items.length === 0) {
        return { success: false, error: "No customer found with this email" };
      }

      const customerId = customers.items[0].id;

      // 2. List active subscriptions for this customer
      const subRes = await fetch(`https://api.polar.sh/v1/subscriptions?customer_id=${customerId}&active=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!subRes.ok) return { success: false, error: "Failed to fetch subscriptions" };
      const subs = await subRes.json();

      const activeSub = subs.items?.find((s: any) => s.status === "active" || s.status === "trialing");

      if (activeSub) {
        return { success: true, isPro: true, email };
      }

      return { success: false, error: "No active Pro subscription found" };
    } catch (err) {
      console.error("Subscription check failed:", err);
      return { success: false, error: "Network error" };
    }
  });

// Server function to verify checkout status with Polar API
export const verifyPolarCheckout = createServerFn({ method: "GET" })
  .handler(async (ctx: any) => {
    const checkoutId = ctx.data as string;
    const token = process.env.POLAR_ACCESS_TOKEN;
    if (!token) {
      console.error("POLAR_ACCESS_TOKEN is not set");
      return { success: false, error: "Server configuration error" };
    }

    try {
      // Use the Polar API to fetch checkout details
      const response = await fetch(`https://api.polar.sh/v1/checkouts/${checkoutId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("Polar API error:", error);
        return { success: false, error: "Failed to verify with Polar" };
      }

      const checkout = await response.json();
      const isPro = checkout.status === "succeeded" || checkout.status === "confirmed";
      
      return { 
        success: true, 
        isPro,
        email: checkout.customer_email 
      };
    } catch (err) {
      console.error("Verification failed:", err);
      return { success: false, error: "Network error during verification" };
    }
  });

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
