"use client"

import { motion } from "framer-motion"
import {
  Download,
  Apple,
  Monitor,
  Cpu,
  ShieldCheck,
  Zap,
  Command,
  Terminal,
  ArrowRight,
  Github,
  CheckCircle2,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { GlassButton } from "@/components/ui/glass-button"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/*  Platform cards                                                     */
/* ------------------------------------------------------------------ */

const platforms = [
  {
    name: "macOS",
    icon: Apple,
    chips: ["Apple Silicon", "Intel"],
    desc: "macOS 12 Monterey or later",
    color: "from-slate-500/20 to-zinc-500/20",
    border: "border-slate-400/20",
    iconColor: "text-slate-300",
    primary: true,
  },
  {
    name: "Windows",
    icon: Monitor,
    chips: ["x64", "ARM64"],
    desc: "Windows 10 (1809) or later",
    color: "from-blue-500/20 to-cyan-500/20",
    border: "border-blue-400/20",
    iconColor: "text-blue-400",
    primary: false,
  },
  {
    name: "Linux",
    icon: Terminal,
    chips: ["AppImage", "deb"],
    desc: "Ubuntu 20.04+, Fedora 36+",
    color: "from-amber-500/20 to-orange-500/20",
    border: "border-amber-400/20",
    iconColor: "text-amber-400",
    primary: false,
  },
]

/* ------------------------------------------------------------------ */
/*  Features                                                           */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: Zap,
    title: "Zero Latency",
    desc: "Direct localhost connection to Ollama, LM Studio, and local models. No network round-trips.",
    color: "text-amber-400",
  },
  {
    icon: ShieldCheck,
    title: "Privacy First",
    desc: "Chat history stays in local SQLite. API keys stored in system keychain. Nothing leaves your machine.",
    color: "text-emerald-400",
  },
  {
    icon: Command,
    title: "OS Integration",
    desc: "Global shortcut (Cmd+K), system tray, native notifications, and file drag & drop.",
    color: "text-purple-400",
  },
  {
    icon: Cpu,
    title: "GPU Acceleration",
    desc: "Native Metal / CUDA support for blazing fast local inference on Apple Silicon and NVIDIA GPUs.",
    color: "text-blue-400",
  },
]

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

const GITHUB_RELEASES = "https://github.com/MarshallEriksen-Neura/Deeting/releases"

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden selection:bg-blue-500/30">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-blue-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-[10%] right-[10%] w-[400px] h-[400px] bg-purple-600/8 rounded-full blur-[100px]" />
        <div className="absolute top-[50%] left-[-5%] w-[350px] h-[350px] bg-indigo-600/5 rounded-full blur-[100px]" />
      </div>

      <div className="container mx-auto px-6 relative z-10 pt-32 pb-24">
        {/* Header section */}
        <div className="text-center max-w-3xl mx-auto mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-accent/50 border border-border backdrop-blur-md text-xs font-medium text-primary"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            v1.0 Stable Release
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl md:text-6xl font-bold tracking-tight mb-6"
          >
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
              Download Deeting
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-muted-foreground leading-relaxed"
          >
            Unlock the full power of local AI — zero latency, complete privacy,
            <br className="hidden md:block" />
            and deep OS integration. Free and open source.
          </motion.p>
        </div>

        {/* Platform cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-24">
          {platforms.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 + i * 0.1 }}
            >
              <a
                href={GITHUB_RELEASES}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "block group relative overflow-hidden rounded-3xl border p-8 backdrop-blur-xl transition-all duration-500 hover:-translate-y-1",
                  p.border,
                  "bg-card/60 hover:bg-accent/50"
                )}
              >
                {/* Hover gradient */}
                <div className={cn("absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-2xl", p.color)} />

                <div className="relative z-10">
                  {/* Icon + name */}
                  <div className="flex items-center justify-between mb-6">
                    <div className={cn("p-3 rounded-2xl bg-accent/50 border border-border", p.iconColor)}>
                      <p.icon className="size-7" />
                    </div>
                    <ArrowRight className="size-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
                  </div>

                  <h3 className="text-2xl font-bold text-foreground mb-2">{p.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{p.desc}</p>

                  {/* Arch chips */}
                  <div className="flex gap-2">
                    {p.chips.map((chip) => (
                      <span
                        key={chip}
                        className="text-[11px] px-2.5 py-1 rounded-full bg-accent/60 border border-border text-muted-foreground font-medium"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
              </a>
            </motion.div>
          ))}
        </div>

        {/* Why Desktop section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-5xl mx-auto mb-24"
        >
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            Why the Desktop App?
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="flex gap-4 p-5 rounded-2xl bg-card/40 border border-border/50 backdrop-blur-sm hover:bg-accent/30 transition-colors"
              >
                <div className={cn("mt-0.5 shrink-0", f.color)}>
                  <f.icon className="size-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center space-y-6"
        >
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href={GITHUB_RELEASES} target="_blank" rel="noopener noreferrer" className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-75 transition duration-200" />
              <Button className="relative px-8 py-4 h-auto rounded-xl font-bold text-base shadow-xl">
                <Download className="w-5 h-5" />
                Download Latest Release
              </Button>
            </a>

            <a
              href="https://github.com/MarshallEriksen-Neura/Deeting"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" className="px-8 py-4 h-auto rounded-xl font-medium">
                <Github className="w-5 h-5" />
                View on GitHub
              </Button>
            </a>
          </div>

          <p className="text-sm text-muted-foreground">
            Open source &middot; MIT License &middot; Free forever
          </p>
        </motion.div>
      </div>
    </div>
  )
}
