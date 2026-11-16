// src/pages/_app.jsx
import React, { useEffect } from "react";
import { useRouter } from "next/router";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import "@/styles/globals.css";
import RootLayout from "./layout";
import ThemeProvider from "../components/ThemeProvider";
import CookieConsentBanner from "../components/Essential/CookieConsentBanner";
import SmoothScroll, { scrollToTarget } from "../components/Essential/SmoothScroll";
import RevealObserver from "../components/Essential/RevealObserver";
import ScrollSpy from "../components/Essential/ScrollSpy";
import { trackVisit } from "../lib/activityTracker";
import Popupform from "@/components/Form/PopupModel";
import GlobalActivityTracker from "../components/GlobalActivityTracker";

// Import tracing utility
import { generateCorrelationId } from "../lib/tracer";
import { createWebsiteLogger } from "../lib/loggerPresets";

const displayFont = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--font-site-display",
});

const bodyFont = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-site-body",
});

const routerLogger = createWebsiteLogger("AppRouter");

// Page transition: the old page leaves quickly (ease-in), the new one settles (ease-out).
const pageVariants = {
  initial: { opacity: 0, y: 14 },
  enter: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.46, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.24, ease: [0.7, 0, 0.84, 0] },
  },
};

export default function App({ Component, pageProps }) {
  const router = useRouter();

  useEffect(() => {
    if (router.isReady) {
      const initialPageTxId = generateCorrelationId();
      // 🚨 TICKET 3: page_loaded
      routerLogger.info("navigation", "page_loaded", {
        correlation: { correlation_id: initialPageTxId },
        context: { endpoint: router.pathname },
      });
      trackVisit(router.pathname, initialPageTxId);
    }

    const handleRouteChange = (url) => {
      const routeTxId = generateCorrelationId();
      // 🚨 TICKET 3: page_loaded
      routerLogger.info("navigation", "page_loaded", {
        correlation: { correlation_id: routeTxId },
        context: { endpoint: url },
      });
      trackVisit(url, routeTxId);
    };

    router.events.on("routeChangeComplete", handleRouteChange);
    return () => router.events.off("routeChangeComplete", handleRouteChange);
  }, [router.isReady, router.pathname]);

  const isLogsPage = router.pathname === "/logs";
  const isDashboard = router.pathname === "/lg";
  const isPublic = !isLogsPage && !isDashboard;

  // Once the old page has left, start the new one at the top (or at its #section).
  const handleExitComplete = () => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.slice(1);
    const el = hash ? document.getElementById(hash) : null;
    if (el) scrollToTarget(el);
    else scrollToTarget(0, { immediate: true });
  };

  return (
    <ThemeProvider>
      <SmoothScroll />
      <RevealObserver />
      <ScrollSpy />
      <RootLayout>
        <GlobalActivityTracker />

        <MotionConfig reducedMotion="user">
          <AnimatePresence mode="wait" initial={false} onExitComplete={handleExitComplete}>
            <motion.div
              key={router.pathname}
              variants={pageVariants}
              initial="initial"
              animate="enter"
              exit="exit"
              className={
                isPublic
                  ? `site ${displayFont.variable} ${bodyFont.variable} w-full flex-grow`
                  : "w-full flex-grow flex flex-col"
              }
            >
              <Component {...pageProps} />
            </motion.div>
          </AnimatePresence>
        </MotionConfig>

        {isPublic && (
          <>
            {/* <Popupform /> */}
            <CookieConsentBanner />
          </>
        )}
      </RootLayout>
    </ThemeProvider>
  );
}
