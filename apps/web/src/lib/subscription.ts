export interface UserStatus {
  isPro: boolean;
  email: string | null;
}

export function getUserStatus(): UserStatus {
  try {
    const saved = localStorage.getItem("foom_user_status");
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error("Failed to load user status:", e);
  }
  return {
    isPro: false,
    email: null,
  };
}

export function setUserStatus(status: UserStatus): void {
  try {
    localStorage.setItem("foom_user_status", JSON.stringify(status));
  } catch (e) {
    console.error("Failed to save user status:", e);
  }
}
