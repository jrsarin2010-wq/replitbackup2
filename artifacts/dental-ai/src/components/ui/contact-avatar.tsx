import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || "?").toUpperCase();
}

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const colors = [
    "bg-rose-500", "bg-pink-500", "bg-fuchsia-500", "bg-purple-500",
    "bg-violet-500", "bg-indigo-500", "bg-blue-500", "bg-sky-500",
    "bg-cyan-500", "bg-teal-500", "bg-emerald-500", "bg-green-500",
    "bg-amber-500", "bg-orange-500",
  ];
  return colors[Math.abs(hash) % colors.length];
}

interface ContactAvatarProps {
  name: string;
  profilePicUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  xs: "w-6 h-6 text-[9px]",
  sm: "w-9 h-9 text-[11px]",
  md: "w-11 h-11 text-sm",
  lg: "w-14 h-14 text-base",
};

export function ContactAvatar({ name, profilePicUrl, size = "sm", className }: ContactAvatarProps) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [profilePicUrl]);

  if (profilePicUrl && !imgError) {
    return (
      <img
        src={profilePicUrl}
        alt={name}
        onError={() => setImgError(true)}
        className={cn("rounded-xl object-cover flex-shrink-0", sizeMap[size], className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-white",
        sizeMap[size],
        hashColor(name),
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
}
