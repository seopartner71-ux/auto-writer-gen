import { useLocation, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useI18n } from "@/shared/hooks/useI18n";
import { motion } from "framer-motion";
import { ArrowLeft, Home, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();
  const { t, lang } = useI18n();
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const glitchChars = "!@#$%^&*()_+-=[]{}|;':\",./<>?";
  const [glitchText, setGlitchText] = useState("404");

  useEffect(() => {
    const interval = setInterval(() => {
      setGlitchText(
        "404".split("").map((ch, i) => (Math.random() > 0.85 ? glitchChars[Math.floor(Math.random() * glitchChars.length)] : ch)).join("")
      );
      setTimeout(() => setGlitchText("404"), 100);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background overflow-hidden">
      {/* Animated grid background */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: "linear-gradient(hsl(270 60% 60% / 0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(270 60% 60% / 0.5) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />

      {/* Glow orbs that follow mouse */}
      <div
        className="pointer-events-none absolute w-[600px] h-[600px] rounded-full bg-primary/[0.08] blur-[200px] transition-transform duration-[2s]"
        style={{ transform: `translate(${mousePos.x * 100 - 50}%, ${mousePos.y * 100 - 50}%)` }}
      />
      <div
        className="pointer-events-none absolute w-[400px] h-[400px] rounded-full bg-[#3b82f6]/[0.06] blur-[180px] transition-transform duration-[3s]"
        style={{ transform: `translate(${mousePos.x * -80 + 40}%, ${mousePos.y * -80 + 40}%)` }}
      />

      {/* Floating particles */}
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute w-1 h-1 rounded-full bg-primary/30"
          initial={{ x: Math.random() * (typeof window !== "undefined" ? window.innerWidth : 1000), y: Math.random() * (typeof window !== "undefined" ? window.innerHeight : 800), opacity: 0 }}
          animate={{
            y: [null, Math.random() * -200 - 100],
            opacity: [0, 0.6, 0],
          }}
          transition={{ duration: 4 + Math.random() * 4, repeat: Infinity, delay: Math.random() * 4, ease: "easeOut" }}
        />
      ))}

      {/* Scan lines */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.015]" style={{
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, hsl(270 60% 60% / 0.1) 2px, hsl(270 60% 60% / 0.1) 4px)",
      }} />

      <div className="relative z-10 text-center px-6 max-w-2xl mx-auto">
        {/* Glitchy 404 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, type: "spring" }}
          className="relative mb-6"
        >
          <span
            className="block text-[12rem] sm:text-[16rem] font-black leading-none select-none"
            style={{
              letterSpacing: "-0.06em",
              background: "linear-gradient(135deg, hsl(270 60% 60%), hsl(210 80% 55%), hsl(270 60% 60%))",
              backgroundSize: "200% 200%",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              animation: "gradient-shift 4s ease-in-out infinite",
              textShadow: "none",
              filter: "drop-shadow(0 0 60px hsl(270 60% 60% / 0.3))",
            }}
          >
            {glitchText}
          </span>
          {/* Ghost shadow */}
          <span
            className="absolute inset-0 block text-[12rem] sm:text-[16rem] font-black leading-none select-none opacity-[0.06] blur-[2px]"
            style={{ letterSpacing: "-0.06em", transform: "translate(4px, 4px)" }}
          >
            404
          </span>
        </motion.div>

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 mb-6"
        >
          <Search className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-mono font-medium text-primary uppercase tracking-wider">
            {lang === "ru" ? "Страница не найдена" : "Page not found"}
          </span>
        </motion.div>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="text-lg text-muted-foreground/80 leading-relaxed mb-3"
        >
          {lang === "ru"
            ? "Эта страница ускользнула от индексации."
            : "This page escaped indexation."}
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="text-sm text-muted-foreground/50 font-mono mb-10"
        >
          <span className="text-primary/60">GET</span>{" "}
          <span className="text-muted-foreground/40">{location.pathname}</span>{" "}
          <span className="text-destructive/60">→ 404</span>
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="flex flex-wrap gap-4 justify-center"
        >
          <Button asChild size="lg" className="group rounded-full px-8 bg-gradient-to-r from-primary to-[#3b82f6] text-white shadow-[0_15px_40px_rgba(139,92,246,0.3)] hover:shadow-[0_20px_60px_rgba(139,92,246,0.45)] hover:scale-[1.03] transition-all duration-300">
            <Link to="/">
              <Home className="mr-2 h-4 w-4" />
              {lang === "ru" ? "На главную" : "Go home"}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="group rounded-full px-8 border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-300">
            <a href="javascript:history.back()">
              <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
              {lang === "ru" ? "Назад" : "Go back"}
            </a>
          </Button>
        </motion.div>

        {/* Fun stealth hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 1 }}
          className="mt-16 flex items-center justify-center gap-2"
        >
          <Sparkles className="h-3 w-3 text-primary/40" />
          <span className="text-[11px] font-mono text-muted-foreground/30 tracking-widest uppercase">
            {lang === "ru" ? "Даже лучший контент иногда теряется" : "Even the best content gets lost sometimes"}
          </span>
          <Sparkles className="h-3 w-3 text-primary/40" />
        </motion.div>
      </div>

      {/* CSS for gradient animation */}
      <style>{`
        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
      `}</style>
    </div>
  );
};

export default NotFound;
