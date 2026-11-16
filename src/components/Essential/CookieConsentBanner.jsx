// src/components/Essential/CookieConsentBanner.jsx

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock } from "lucide-react";
import { ref, set } from "firebase/database";
import { db } from "../../lib/firebase";
import {
  setStrictCookie,
  getStrictCookie,
  getOrCreateAnonId,
  CONSENT_COOKIE_NAME,
} from "../../lib/cookiePersonalization";

// Implement the new Website Logger and Tracer
import { createWebsiteLogger } from "../../lib/loggerPresets";
import { generateCorrelationId } from "../../lib/tracer";

const baseLogger = createWebsiteLogger("CookieConsentBanner");

/**
 * Helper: Parses the browser environment into a clean, readable Device Name
 */
function getReadableDeviceName() {
  if (typeof window === "undefined") return "Unknown Device";
  const ua = navigator.userAgent;
  let os = "Unknown OS";
  let type = "Desktop";

  if (/Windows/i.test(ua)) os = "Windows PC";
  else if (/Macintosh|Mac OS X/i.test(ua)) os = "Macintosh";
  else if (/Android/i.test(ua)) {
    os = "Android";
    type = "Mobile";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    os = "iOS Device";
    type = "Mobile";
  } else if (/Linux/i.test(ua)) os = "Linux";

  if (/Tablet|iPad/i.test(ua)) type = "Tablet";

  return `${os} (${type})`;
}

/**
 * Helper: Fetches the user's public IPv4 address AND location based on that IP.
 */
const getIpAndLocation = async (txLogger = baseLogger) => {
  try {
    const response = await fetch("https://ipinfo.io/json");
    const data = await response.json();
    let lat = null,
      lng = null;

    if (data.loc) {
      const [parsedLat, parsedLng] = data.loc.split(",");
      lat = parseFloat(parsedLat);
      lng = parseFloat(parsedLng);
    }

    return {
      ip: data.ip || "unknown",
      city: data.city || "Unknown",
      region: data.region || "Unknown",
      country: data.country || "Unknown",
      lat,
      lng,
    };
  } catch (error) {
    txLogger.warn("network_request", "ip_fetch_failed", { error });
    return {
      ip: "unknown",
      city: "Unknown",
      region: "Unknown",
      country: "Unknown",
      lat: null,
      lng: null,
    };
  }
};

/**
 * Helper: Requests the user's location via the browser's Geolocation API.
 */
const getUserLocation = (txLogger = baseLogger) => {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      resolve({ status: "unsupported", lat: null, lng: null });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          status: "allowed",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      (error) => {
        txLogger.debug("user_action", "geolocation_denied", {
          error,
          code: error.code,
        });
        resolve({
          status: "denied",
          code: error.code,
          lat: null,
          lng: null,
        });
      },
      { timeout: 8000, enableHighAccuracy: true },
    );
  });
};

/**
 * Main Worker: Captures all user footprint details and logs it to Firebase.
 */
const executeSilentTracking = async (consentStatus) => {
  const transactionId = generateCorrelationId();
  const txLogger = createWebsiteLogger("CookieConsentBanner", {
    correlation_id: transactionId,
  });

  try {
    const anonId = getOrCreateAnonId();
    const readableDevice = getReadableDeviceName();

    const [ipInfo, locationResult] = await Promise.all([
      getIpAndLocation(txLogger),
      getUserLocation(txLogger),
    ]);

    const activeLat =
      locationResult.lat !== null ? locationResult.lat : ipInfo.lat;
    const activeLng =
      locationResult.lng !== null ? locationResult.lng : ipInfo.lng;

    const payload = {
      user_id: anonId,
      consent_status: consentStatus,
      timestamp: Date.now(),
      readable_device: readableDevice,
      network: {
        ip: ipInfo.ip,
        city: ipInfo.city,
        region: ipInfo.region,
        country: ipInfo.country,
      },
      browser_location: {
        status: locationResult.status,
        latitude: activeLat,
        longitude: activeLng,
      },
      environment: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        referrer: document.referrer || "direct",
      },
    };

    const targetRef = ref(db, `user_sessions/${anonId}`);
    await set(targetRef, payload);

    txLogger.info("user_action", "consent_logged_successfully", {
      correlation: { correlation_id: transactionId },
      context: { consent: consentStatus, user_id: anonId },
    });
  } catch (error) {
    txLogger.error("database_mutation", "consent_save_failed", {
      correlation: { correlation_id: transactionId },
      error,
    });
  }
};

export default function CookieConsentBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const existingConsent = getStrictCookie(CONSENT_COOKIE_NAME);

    // Accepted: track as before. Rejected: remember the choice and stay quiet.
    if (existingConsent && existingConsent.status === "accepted") {
      executeSilentTracking(existingConsent.status);
    } else if (existingConsent && existingConsent.status === "rejected") {
      // The visitor already said no; do not ask again on every page load.
    } else {
      // No decision yet: show the banner
      setShowBanner(true);
      document.body.style.overflow = "hidden";

      baseLogger.info("ui_render", "banner_displayed", {
        context: { message: "Cookie banner locked screen" },
      });
    }

    // Cleanup function
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const closeBanner = () => {
    // Clear the inline lock so the stylesheet (overflow-x: clip) applies again
    document.body.style.overflow = "";
    setShowBanner(false);
  };

  const handleDecision = async (status) => {
    setIsSaving(true);

    // Save the decision either way, so a visitor who rejects is not asked again
    setStrictCookie(CONSENT_COOKIE_NAME, { status, timestamp: Date.now() });

    // Execute the tracking for this specific page view
    await executeSilentTracking(status);

    setIsSaving(false);
    closeBanner();
  };

  return (
    <AnimatePresence>
      {showBanner && (
        <>
          {/* Background Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[9998] bg-[var(--background)]/80 backdrop-blur-sm select-none"
            aria-hidden="true"
          />

          {/* Banner */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            className="fixed top-4 left-4 right-4 md:right-auto md:w-[360px] z-[9999] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-md p-5"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="flex w-9 h-9 bg-[var(--primary)]/15 text-[var(--primary)] items-center justify-center rounded-full shrink-0">
                <Lock size={16} aria-hidden="true" />
              </div>
              <h2 className="text-base font-bold text-[var(--foreground)] leading-none">
                Cookie &amp; Location Policy
              </h2>
            </div>

            <p className="text-sm text-[var(--foreground-muted)] mb-5 leading-relaxed">
              We use essential browser cookies and log basic device metrics
              (including an optional location request) to secure our platform.
              Please accept or reject to unlock the website.
            </p>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => handleDecision("accepted")}
                disabled={isSaving}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl font-semibold text-sm text-[var(--foreground)] bg-[var(--card-bg)] hover:bg-[var(--background)] border border-[var(--border-color)] hover:border-[var(--foreground-muted)] transition-colors duration-150 motion-safe:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] cursor-pointer"
              >
                {isSaving ? "Awaiting Permissions…" : "Accept All Cookies"}
              </button>

              <button
                onClick={() => handleDecision("rejected")}
                disabled={isSaving}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl font-semibold text-sm text-[var(--foreground)] bg-[var(--card-bg)] hover:bg-[var(--background)] border border-[var(--border-color)] hover:border-[var(--foreground-muted)] transition-colors duration-150 motion-safe:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] cursor-pointer"
              >
                {isSaving ? "Awaiting Permissions…" : "Reject Non-Essential"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
